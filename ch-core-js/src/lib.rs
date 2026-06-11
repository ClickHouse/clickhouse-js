use std::io;
use std::sync::Arc;

use napi::bindgen_prelude::*;
use napi::{Env, JsObject};
use napi_derive::napi;

use ch_core_rs::batch::ColBatch;
use ch_core_rs::column::Column;
use ch_core_rs::native::decode::{decode_all_bytes, DecodeError, DecodeOptions};
use ch_core_rs::native::stream_decoder::StreamDecoder;

/// Map a core `DecodeError` to a napi error with a status JS can branch on.
///
/// `InvalidArg` marks input that can never decode no matter how many bytes
/// arrive: unsupported types or serializations, corrupt block framing, a
/// block whose schema differs from the first block's, and the corruptions
/// the core reports as `Io` with kind `InvalidData` (varint overflow,
/// invalid UTF-8 in a column header, String chunk offset overflow).
/// `GenericFailure` marks the remaining I/O-shaped failures, including the
/// truncated-tail `UnexpectedEof` from `finish()`, where the bytes were
/// plausible but the stream ended or misbehaved.
fn decode_error_to_napi(e: DecodeError) -> Error {
    let status = match &e {
        DecodeError::UnsupportedType { .. }
        | DecodeError::UnsupportedSerialization { .. }
        | DecodeError::InvalidBlockInfo { .. }
        | DecodeError::BlockSchemaMismatch { .. } => Status::InvalidArg,
        DecodeError::Io(e) if e.kind() == io::ErrorKind::InvalidData => Status::InvalidArg,
        DecodeError::Io(_) => Status::GenericFailure,
    };
    Error::new(status, e.to_string())
}

/// Checked `usize -> u32` for `env.create_array` lengths. Throws a JS error
/// instead of silently truncating a count that exceeds `u32::MAX`.
fn array_len(len: usize, what: &str) -> Result<u32> {
    u32::try_from(len)
        .map_err(|_| Error::from_reason(format!("{what} count {len} exceeds u32::MAX")))
}

/// Build a napi typed array that *views* a slice owned inside `owner` (an
/// `Arc<ColBatch>`) without copying the bytes. A clone of `owner` is moved into
/// the view's GC finalizer, so the backing buffer stays alive until V8 collects
/// the view, then the `Arc` is dropped (freeing the `ColBatch` once it is the
/// last reference). Empty slices fall back to an owned empty array so we never
/// hand napi a dangling pointer.
///
/// Safety: the core never mutates or reallocates a column buffer after decode,
/// so the pointer is stable for `owner`'s lifetime. Each buffer is exported to
/// exactly one view, matching the Arrow C Data zero-copy export model (JS may
/// mutate the view, which writes into Rust-owned memory that nothing else reads).
macro_rules! external_array {
    ($ArrTy:ident, $elem:ty, $slice:expr, $owner:expr) => {{
        let s: &[$elem] = $slice;
        if s.is_empty() {
            $ArrTy::new(Vec::new())
        } else {
            let owner: Arc<ColBatch> = $owner.clone();
            let ptr = s.as_ptr() as *mut $elem;
            let len = s.len();
            unsafe { $ArrTy::with_external_data(ptr, len, move |_p, _l| drop(owner)) }
        }
    }};
}

/// Diagnostic: decode the Native buffer in the Rust core and return only the row
/// count. This is the pure-core decode floor for buffered Native input.
#[napi]
pub fn decode_native_count(buf: Buffer) -> Result<f64> {
    let data: &[u8] = &buf;
    let batch = decode_all_bytes(
        data,
        &DecodeOptions {
            protocol_revision: 0,
        },
    )
    .map_err(decode_error_to_napi)?;
    Ok(batch.chunks.iter().map(|c| c.num_rows).sum::<usize>() as f64)
}

/// Decode ClickHouse Native-format bytes into schema + per-chunk columnar buffers.
///
/// This keeps ClickHouse Native blocks as independent chunks and crosses the N-API
/// boundary once per column buffer, not once per cell. Nullable columns expose an
/// Arrow-style packed validity bitmap: bit=1 means valid, bit=0 means null.
#[napi]
pub fn decode_native_columns(env: Env, buf: Buffer) -> Result<JsObject> {
    let data: &[u8] = &buf;
    let batch = decode_all_bytes(
        data,
        &DecodeOptions {
            protocol_revision: 0,
        },
    )
    .map_err(decode_error_to_napi)?;

    let column_names: Vec<String> = batch.schema.fields.iter().map(|f| f.name.clone()).collect();
    let column_types: Vec<String> = batch
        .schema
        .fields
        .iter()
        .map(|f| f.ch_type.to_string())
        .collect();
    let row_count = batch.chunks.iter().map(|c| c.num_rows).sum::<usize>();

    // Each chunk is rendered from its OWN schema (`chunk_to_js`), never by
    // indexing a later block with the first block's column count: the core
    // only validates the schema of the first block, so a misbehaving stream
    // may carry blocks with differing column counts.
    let mut chunks = env.create_array(array_len(batch.chunks.len(), "chunk")?)?;
    for (chunk_idx, chunk) in batch.chunks.iter().enumerate() {
        chunks.set(chunk_idx as u32, chunk_to_js(&env, chunk)?)?;
    }

    let mut result = env.create_object()?;
    result.set_named_property("rowCount", row_count as f64)?;
    result.set_named_property("columnNames", column_names)?;
    result.set_named_property("columnTypes", column_types)?;
    result.set_named_property("chunks", chunks)?;
    Ok(result)
}

/// Incremental Native decoder for HTTP response streams.
///
/// `push` appends bytes, decodes every complete Native block currently
/// available, and retains only the trailing bytes of an incomplete block.
/// Zero-row blocks (e.g. the header-only block of an empty result) contribute
/// schema (`columnNames`/`columnTypes`) but are omitted from `chunks`. `finish`
/// fails if the stream ended with an incomplete block, or with no blocks at all.
#[napi]
pub struct NativeStreamDecoder {
    decoder: StreamDecoder,
    column_names: Option<Vec<String>>,
    column_types: Option<Vec<String>>,
    row_count: usize,
    /// Binding-level lifecycle guard. The core decoder also tracks finished
    /// state, but its post-finish behavior (feed errors with a generic I/O
    /// message, finish returns Ok with no blocks) does not match the JS
    /// contract, which promises distinct errors for push-after-finish and
    /// double-finish.
    finished: bool,
    /// Poisoned after any decode error: the core's internal buffer still holds
    /// the bytes that failed, so further pushes would rescan the poisoned
    /// buffer on every call (O(n^2)) and could silently drop rows. Once set,
    /// `push` and `finish` fail fast and the caller must create a new decoder.
    errored: bool,
}

#[napi]
impl NativeStreamDecoder {
    #[napi(constructor)]
    pub fn new() -> Self {
        Self {
            decoder: StreamDecoder::new(DecodeOptions {
                protocol_revision: 0,
            }),
            column_names: None,
            column_types: None,
            row_count: 0,
            finished: false,
            errored: false,
        }
    }

    #[napi]
    pub fn push(&mut self, env: Env, buf: Buffer) -> Result<JsObject> {
        self.check_usable()?;
        if self.finished {
            return Err(Error::new(
                Status::InvalidArg,
                "cannot push after finish".to_string(),
            ));
        }

        let batches = self.decoder.feed(&buf).map_err(|e| {
            self.errored = true;
            decode_error_to_napi(e)
        })?;
        self.emit_batches(&env, batches)
    }

    #[napi]
    pub fn finish(&mut self, env: Env) -> Result<JsObject> {
        self.check_usable()?;
        if self.finished {
            return Err(Error::new(
                Status::InvalidArg,
                "NativeStreamDecoder.finish() called more than once".to_string(),
            ));
        }
        // Mark finished before draining so a truncated-tail error still ends
        // the stream, matching the core decoder's own finished state.
        self.finished = true;

        let batches = self.decoder.finish().map_err(|e| {
            self.errored = true;
            decode_error_to_napi(e)
        })?;

        // A real ClickHouse Native response always carries at least one block
        // (a zero-row header block for empty results), so a stream that ends
        // without ever producing a schema is a dead/empty connection, not a
        // legitimate empty result. This matches `decode_native_columns`, which
        // errors on a zero-byte buffer. (If `batches` is non-empty here,
        // `emit_batches` captures the schema from its first block.)
        if self.column_names.is_none() && batches.is_empty() {
            self.errored = true;
            return Err(Error::new(
                Status::GenericFailure,
                "stream ended with no blocks".to_string(),
            ));
        }

        self.emit_batches(&env, batches)
    }

    #[napi(getter)]
    pub fn row_count(&self) -> f64 {
        self.row_count as f64
    }

    #[napi(getter)]
    pub fn buffered_bytes(&self) -> f64 {
        self.decoder.buffered_bytes() as f64
    }
}

impl Default for NativeStreamDecoder {
    fn default() -> Self {
        Self::new()
    }
}

impl NativeStreamDecoder {
    /// Fail fast once the decoder is poisoned by a prior decode error. The
    /// core's buffer still holds the failing bytes, so continuing would rescan
    /// them on every push and could silently lose rows. Caller bug, hence
    /// `InvalidArg` like the other lifecycle errors.
    fn check_usable(&self) -> Result<()> {
        if self.errored {
            return Err(Error::new(
                Status::InvalidArg,
                "decoder failed previously; create a new NativeStreamDecoder".to_string(),
            ));
        }
        Ok(())
    }

    /// Shared emission path for `push` and `finish`: capture the schema from
    /// the first decoded block (even a zero-row header-only block), drop
    /// zero-row blocks from the JS-facing output, and account emitted rows.
    fn emit_batches(&mut self, env: &Env, batches: Vec<ColBatch>) -> Result<JsObject> {
        if self.column_names.is_none() {
            if let Some(first) = batches.first() {
                self.column_names =
                    Some(first.schema.fields.iter().map(|f| f.name.clone()).collect());
                self.column_types = Some(
                    first
                        .schema
                        .fields
                        .iter()
                        .map(|f| f.ch_type.to_string())
                        .collect(),
                );
            }
        }

        let batches: Vec<ColBatch> = batches.into_iter().filter(|b| b.num_rows > 0).collect();
        let emitted_rows = batches.iter().map(|b| b.num_rows).sum::<usize>();
        self.row_count += emitted_rows;
        stream_decode_result(
            env,
            emitted_rows,
            self.column_names.as_deref().unwrap_or(&[]),
            self.column_types.as_deref().unwrap_or(&[]),
            batches,
            self.decoder.buffered_bytes(),
        )
    }
}

fn column_base(env: &Env, name: &str, type_name: &str, kind: &str) -> Result<JsObject> {
    let mut obj = env.create_object()?;
    obj.set_named_property("name", name)?;
    obj.set_named_property("type", type_name)?;
    obj.set_named_property("kind", kind)?;
    Ok(obj)
}

fn set_validity(obj: &mut JsObject, owner: &Arc<ColBatch>, col: &Column) -> Result<()> {
    if let Some(validity) = col.validity() {
        obj.set_named_property(
            "validity",
            external_array!(Uint8Array, u8, validity.as_bytes(), owner),
        )?;
    }
    Ok(())
}

fn column_to_js(
    env: &Env,
    owner: &Arc<ColBatch>,
    name: &str,
    type_name: &str,
    col: &Column,
) -> Result<JsObject> {
    let mut obj = match col {
        Column::Bool(c) => {
            let mut obj = column_base(env, name, type_name, "Bool")?;
            obj.set_named_property("length", c.len() as f64)?;
            obj.set_named_property("bitmap", external_array!(Uint8Array, u8, &c.bitmap, owner))?;
            obj
        }
        Column::Int8(c) => {
            let mut obj = column_base(env, name, type_name, "Int8")?;
            obj.set_named_property("values", external_array!(Int8Array, i8, &c.values, owner))?;
            obj
        }
        Column::Int16(c) => {
            let mut obj = column_base(env, name, type_name, "Int16")?;
            obj.set_named_property("values", external_array!(Int16Array, i16, &c.values, owner))?;
            obj
        }
        Column::Int32(c) => {
            let mut obj = column_base(env, name, type_name, "Int32")?;
            obj.set_named_property("values", external_array!(Int32Array, i32, &c.values, owner))?;
            obj
        }
        Column::Int64(c) => {
            let mut obj = column_base(env, name, type_name, "Int64")?;
            obj.set_named_property(
                "values",
                external_array!(BigInt64Array, i64, &c.values, owner),
            )?;
            obj
        }
        Column::UInt8(c) => {
            let mut obj = column_base(env, name, type_name, "UInt8")?;
            obj.set_named_property("values", external_array!(Uint8Array, u8, &c.values, owner))?;
            obj
        }
        Column::UInt16(c) => {
            let mut obj = column_base(env, name, type_name, "UInt16")?;
            obj.set_named_property(
                "values",
                external_array!(Uint16Array, u16, &c.values, owner),
            )?;
            obj
        }
        Column::UInt32(c) => {
            let mut obj = column_base(env, name, type_name, "UInt32")?;
            obj.set_named_property(
                "values",
                external_array!(Uint32Array, u32, &c.values, owner),
            )?;
            obj
        }
        Column::UInt64(c) => {
            let mut obj = column_base(env, name, type_name, "UInt64")?;
            obj.set_named_property(
                "values",
                external_array!(BigUint64Array, u64, &c.values, owner),
            )?;
            obj
        }
        Column::Float32(c) => {
            let mut obj = column_base(env, name, type_name, "Float32")?;
            obj.set_named_property(
                "values",
                external_array!(Float32Array, f32, &c.values, owner),
            )?;
            obj
        }
        Column::Float64(c) => {
            let mut obj = column_base(env, name, type_name, "Float64")?;
            obj.set_named_property(
                "values",
                external_array!(Float64Array, f64, &c.values, owner),
            )?;
            obj
        }
        Column::Date(c) => {
            let mut obj = column_base(env, name, type_name, "Date")?;
            obj.set_named_property(
                "values",
                external_array!(Uint16Array, u16, &c.values, owner),
            )?;
            obj
        }
        Column::Date32(c) => {
            let mut obj = column_base(env, name, type_name, "Date32")?;
            obj.set_named_property("values", external_array!(Int32Array, i32, &c.values, owner))?;
            obj
        }
        Column::DateTime(c) => {
            let mut obj = column_base(env, name, type_name, "DateTime")?;
            obj.set_named_property(
                "values",
                external_array!(Uint32Array, u32, &c.values, owner),
            )?;
            obj
        }
        Column::DateTime64(c) => {
            let mut obj = column_base(env, name, type_name, "DateTime64")?;
            obj.set_named_property(
                "values",
                external_array!(BigInt64Array, i64, &c.values, owner),
            )?;
            obj
        }
        Column::Utf8(c) => {
            let mut obj = column_base(env, name, type_name, "String")?;
            obj.set_named_property(
                "offsets",
                external_array!(Int32Array, i32, &c.offsets, owner),
            )?;
            obj.set_named_property("data", external_array!(Uint8Array, u8, &c.data, owner))?;
            obj
        }
        Column::FixedBinary(c) => {
            let mut obj = column_base(env, name, type_name, "FixedString")?;
            obj.set_named_property("width", c.width as f64)?;
            obj.set_named_property("data", external_array!(Uint8Array, u8, &c.data, owner))?;
            obj
        }
    };
    set_validity(&mut obj, owner, col)?;
    Ok(obj)
}

fn chunk_to_js(env: &Env, batch: &Arc<ColBatch>) -> Result<JsObject> {
    // A decoded ColBatch always carries one field per column; check rather
    // than assume, because indexing past either end would panic and a panic
    // in a napi call aborts the Node process.
    if batch.schema.fields.len() != batch.num_columns() {
        return Err(Error::from_reason(format!(
            "decoded block is inconsistent: {} schema fields but {} columns",
            batch.schema.fields.len(),
            batch.num_columns()
        )));
    }

    let mut chunk_obj = env.create_object()?;
    chunk_obj.set_named_property("rowCount", batch.num_rows as f64)?;

    let mut columns = env.create_array(array_len(batch.num_columns(), "column")?)?;
    for (col_idx, field) in batch.schema.fields.iter().enumerate() {
        let col = batch.column(col_idx);
        let col_obj = column_to_js(env, batch, &field.name, &field.ch_type.to_string(), col)?;
        columns.set(col_idx as u32, col_obj)?;
    }

    chunk_obj.set_named_property("columns", columns)?;
    Ok(chunk_obj)
}

fn stream_decode_result(
    env: &Env,
    row_count: usize,
    column_names: &[String],
    column_types: &[String],
    batches: Vec<ColBatch>,
    buffered_bytes: usize,
) -> Result<JsObject> {
    let mut chunks = env.create_array(array_len(batches.len(), "chunk")?)?;
    for (idx, batch) in batches.into_iter().enumerate() {
        // Wrap each decoded block in an Arc so its column buffers can be exported
        // as zero-copy views; finalizer clones keep it alive past this loop.
        let batch = Arc::new(batch);
        chunks.set(idx as u32, chunk_to_js(env, &batch)?)?;
    }

    let mut result = env.create_object()?;
    result.set_named_property("rowCount", row_count as f64)?;
    result.set_named_property("columnNames", column_names.to_vec())?;
    result.set_named_property("columnTypes", column_types.to_vec())?;
    result.set_named_property("chunks", chunks)?;
    result.set_named_property("bufferedBytes", buffered_bytes as f64)?;
    Ok(result)
}
