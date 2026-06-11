# ch-core-js — the Node.js binding for the `ch-core-rs` Native decoder

`ch-core-js` is a small N-API (napi-rs) addon that lets Node.js decode ClickHouse
`FORMAT Native` responses using the shared Rust core (`ch-core-rs`) and hand the
result to JavaScript as **columnar TypedArray views over Rust-owned memory** —
no per-cell conversion, no copy of the column buffers.

## The big picture

Reading query results in JavaScript today means JSON: ClickHouse serializes
every value to text, the client splits the body into lines, and `JSON.parse`
runs once per row. Every number is printed and re-parsed, every string is
escaped and unescaped, and the engine allocates a JS object per row and a JS
value per cell. That per-cell work is the cost, and it grows linearly with
`rows × columns`.

This binding takes a different route end to end:

```
ClickHouse ──(FORMAT Native: binary, columnar)──▶ HTTP body bytes
                                                       │
                                          push() raw chunks as they arrive
                                                       ▼
                                  ┌───────────────────────────────────────┐
                                  │  ch-core-js (this addon)              │
                                  │   └─ ch-core-rs: parse block framing  │
                                  │      + column data into typed Vecs    │
                                  └───────────────────────────────────────┘
                                                       │
                                     one TypedArray *view* per column buffer
                                                       ▼
                                  JS: { chunks: [{ rowCount, columns: [...] }] }
```

Three ideas carry all of the performance:

1. **The wire format is already columnar and binary.** A `Float64` column in a
   Native block is literally a contiguous run of little-endian doubles — the
   same bytes a `Float64Array` wants. Nothing needs to be "parsed" per value;
   the work is framing (block headers, type names, lengths), which is per
   _column_, not per cell. The Native body is also 1.5–2.7x smaller than the
   JSON formats on the wire.

2. **Cross the JS↔Rust boundary per column, not per cell.** N-API calls are
   expensive. The addon makes a handful of object/property calls per column
   per block, and exactly zero calls per row. A 1M×6 result crosses the
   boundary a few dozen times, not six million.

3. **Export buffers zero-copy.** The decoded Rust `Vec`s are not copied into
   V8. Each column buffer is wrapped in a TypedArray that points directly at
   the Rust memory, with a GC finalizer keeping the Rust allocation alive
   until JavaScript drops the last view.

What that buys, measured end to end through the real `@clickhouse/client`
transport on both legs (1M rows × 6 columns, ClickHouse 26.2.4 over localhost,
macOS, medians of 7 runs via `bench_client.mjs`):

| Consumer shape                                | Rust Native path     | JSON path | Speedup   |
| --------------------------------------------- | -------------------- | --------- | --------- |
| Columns (TypedArrays)                         | 47 ms — 21.1M rows/s | 411 ms    | **~8.7x** |
| Rows as arrays (fully materialized JS values) | 176 ms               | 399 ms    | **~2.3x** |
| Rows as objects                               | 216 ms               | 548 ms    | **~2.5x** |

The spread between 8.7x and 2.3x is the third lesson of the design: the decode
itself is ~58x faster than JSON parsing, so once you materialize JS rows, _row
materialization_ (allocating objects, decoding strings) becomes the bottleneck
— cost the JSON path also pays, which is why the ratio compresses. **The
binding's value is greatest for consumers that can stay columnar**, and that is
why its API surface is column-centric: rows are a thin JS layer on top, not
something the addon produces.

## API at a glance

```js
const {
  decodeNativeColumns,
  NativeStreamDecoder,
  decodeNativeCount,
} = require('./ch-core-js.node')

// One-shot: decode a fully buffered Native response body
const { chunks, columnNames, columnTypes, rowCount } = decodeNativeColumns(buf)

// Streaming: feed HTTP chunks as they arrive
const dec = new NativeStreamDecoder()
for await (const chunk of httpBodyStream) {
  const out = dec.push(chunk) // { chunks, columnNames, columnTypes, rowCount, bufferedBytes }
  // out.chunks contains every Native block completed by this push (often [])
}
const tail = dec.finish() // drains the final block; throws on a truncated stream

// Diagnostic: pure-core decode floor (row count only, nothing exported to JS)
const n = decodeNativeCount(buf)
```

Both paths return the same shape: an array of `chunks` (one per ClickHouse
Native block, kept separate — no concatenation), plus the schema
(`columnNames`, `columnTypes` as canonical ClickHouse type strings) and the
total `rowCount`.

## Scope of the POC

### Type coverage

Supported today: `Bool`, `Int8`–`Int64`, `UInt8`–`UInt64`, `Float32/64`,
`String`, `FixedString(N)`, `Date`, `Date32`, `DateTime`, `DateTime64`, and
`Nullable(...)` of any of those.

Not yet implemented (phased in the core's roadmap): `Decimal`, `UUID`,
`IPv4/IPv6`, `Enum8/16`, `LowCardinality`, `Array`, `Tuple`, `Map`,
`Int128/256` / `UInt128/256`. A result containing one of these fails cleanly
with an `InvalidArg` error naming the type — never a crash — so a consumer can
fall back to the JSON path. New types land in `ch-core-rs` first; the binding
then adds an export arm (its column `match` is intentionally exhaustive, so it
won't compile until someone decides the new type's JS shape).

### Deliberate POC shortcuts (and the production path)

- **Client routing:** the experimental `queryNativeColumns` / `queryNativeRows`
  methods go through `client.exec()` — the right shortcut because it reuses the
  full transport stack (socket pool, settings/params merge, parsed
  `ClickHouseError`s on non-2xx) without touching `ResultSet`, whose
  `stream()` newline-splits and would corrupt binary. The productized path is
  `connection.query()` with `Native` as a first-class `DataFormat` (uniform
  compression-header behavior, Query op semantics).
- **Addon discovery:** the client loads the addon lazily from this directory's
  repo-relative path, overridable via `CH_CORE_JS_ADDON_PATH`. Production would
  ship prebuilt per-platform binaries through the standard napi-rs CLI
  packaging — out of scope here. Regular client usage never touches the addon;
  if it's missing, the `queryNative*` methods fail fast with a clear error
  _before_ sending the query, and everything else works normally.
- **Core dependency:** `Cargo.toml` uses a path dep on a side-by-side
  `ch-core-rs` clone. That repo is currently private — you can read and review
  everything in this directory, but building the addon requires access (ask
  Joe). End state: a git dependency pinned to a commit on the org repo.
- **One real bug fix rides along:** `createClient` previously returned the base
  `ClickHouseClient` _cast_ to `NodeClickHouseClient`, so any method added to
  the Node subclass silently didn't exist at runtime. It now instantiates the
  subclass. Behavior-neutral for everything else (58 integration + 125 unit
  tests pass unchanged).
- **Node-only.** The web package is untouched.

Verification status at time of writing: typecheck/lint/build clean;
`client_native_check.mjs` PASS (13 types vs a JSON oracle across 100k rows,
plus pre-stream error, mid-stream exception, mid-stream abort, already-aborted
signal, trailing-`--`-comment, and `__proto__`-column cases); reviewed by a
second model (Codex) with all findings fixed.

## Evaluating it: build and run everything

Prerequisites: a Rust toolchain, Node 22 (repo `.nvmrc`; engines allow
≥20.19), Docker (or any ClickHouse listening on `localhost:8123` with default
credentials), and `ch-core-rs` cloned **next to** the `clickhouse-js` checkout
(the path dep resolves `../../ch-core-rs` relative to this directory):

```sh
dev/
├── clickhouse-js/        # this repo, branch joe/rust-core-experiment
└── ch-core-rs/           # git clone github.com/ClickHouse/ch-core-rs (private)
```

```sh
# 1. repo setup (root): install + build the workspace packages
npm install && npm run build

# 2. build the addon
cd ch-core-js
npm install && npm run build       # napi build --release → ch-core-js.node

# 3. start ClickHouse if needed (repo root)
docker compose up -d

# 4. correctness + regression harnesses
node nonuniform_check.mjs                  # synthetic payloads; no server needed
node --expose-gc zerocopy_check.mjs        # queries numbers(); no table needed
node client_native_check.mjs               # client methods vs JSON oracle; numbers() only
ROWS=1000000 node --expose-gc bench_client.mjs   # ALSO creates/fills bench_types
node verify.mjs                            # needs bench_types (run bench_client first)
ROWS=1000000 node --expose-gc bench_fair.mjs     # needs bench_types too
```

Note the ordering: `bench_client.mjs` creates and tops up the `bench_types`
table (and asserts its schema if it already exists); `verify.mjs` and
`bench_fair.mjs` expect it to be there.

To try the client methods directly:

```js
const { createClient } = require('../packages/client-node/dist/index.js')
const client = createClient({ url: 'http://localhost:8123' })

// NB: no FORMAT clause — it is appended internally
const cols = await client.queryNativeColumns({
  query: 'SELECT * FROM bench_types LIMIT 10',
})
console.log(
  cols.columnNames,
  cols.columnTypes,
  cols.rowCount,
  cols.chunks[0].columns[0].values,
)

const rows = await client.queryNativeRows({
  query: 'SELECT * FROM bench_types LIMIT 10',
}) // or row_shape: 'arrays'
console.log(rows.rows[0])

await client.close()
```

Both methods accept the usual `BaseQueryParams` (settings, query params,
`abort_signal`, session, auth, headers) — everything except `format`.

---

# Details

## Layer map

There are four layers, with a deliberate division of labor:

| Layer          | Code                                                                                                                           | Owns                                                                                                                                                                                                          |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**       | `ch-core-rs` (separate repo, zero deps)                                                                                        | Wire-format truth: Native block framing, type-name parsing (`parse_ch_type` / `ChType::Display`), column deserialization into typed `Vec`s, schema validation across blocks, the incremental `StreamDecoder`. |
| **Binding**    | `ch-core-js/src/lib.rs` (this crate)                                                                                           | The N-API boundary only: zero-copy buffer export, error-code mapping, stream lifecycle guards (post-error poisoning, push-after-finish), schema capture for streaming. **No decode logic.**                   |
| **JS surface** | the objects the addon returns                                                                                                  | A stable per-`kind` buffer contract (below) that any JS consumer can program against.                                                                                                                         |
| **Consumers**  | e.g. `@clickhouse/client`'s experimental `queryNativeColumns` / `queryNativeRows` (`packages/client-node/src/native_query.ts`) | Transport, abort handling, and _optional_ row materialization in plain JS.                                                                                                                                    |

The rule that keeps this maintainable: **wire-format bugs are core bugs.** The
binding never re-parses type names, never re-frames blocks, never touches
column bytes. If a new ClickHouse type needs support, it lands in `ch-core-rs`
first and the binding only adds an export arm for the new column variant.

## How the binding drives the core

- The core decodes from a borrowing slice cursor (`ByteReader<'a>`), so the
  binding hands it `&[u8]` views of the incoming `Buffer`s — no copy on the
  way in either (napi `Buffer` derefs to a byte slice).
- The buffered path calls `decode_all_bytes`, the streaming path wraps the
  core's `StreamDecoder` (`feed` / `finish`). The binding does **not**
  hand-roll its own partial-block buffering; the core retains incomplete-block
  tail bytes internally and `bufferedBytes` exposes how many.
- Column types reported to JS come from `ChType`'s `Display` impl, which is
  contractually the same canonical string `parse_ch_type` accepts — so
  `columnTypes` round-trips and JS can dispatch on it.
- The core validates that every block matches the first block's schema
  (`BlockSchemaMismatch`); the binding additionally re-checks
  fields-vs-columns consistency per block before indexing, because an
  out-of-bounds panic inside an `extern "C"` napi trampoline would abort the
  whole Node process (`#[napi]` has no `catch_unwind` here). Panics are treated
  as a binding bug class to be designed out, not caught.

## Zero-copy export: how the buffers actually move

The heart of the binding is one macro, `external_array!`:

```rust
let owner: Arc<ColBatch> = batch.clone();          // refcount the decoded block
let ptr = slice.as_ptr() as *mut T;
unsafe { TypedArrayN::with_external_data(ptr, len, move |_p, _l| drop(owner)) }
```

- Every decoded Native block (`ColBatch`) is wrapped in an `Arc`.
- Each column buffer in the block is exported as **one** TypedArray whose data
  pointer aims straight into the Rust `Vec`. A clone of the `Arc` moves into
  the array's GC finalizer, so the block stays alive until V8 collects that
  view, and the Rust memory is freed when the last view (and the binding's own
  reference) is gone.
- Empty slices fall back to an owned empty array, so napi is never handed a
  dangling or null pointer.
- If a JS runtime forbids external array buffers (some Electron
  configurations), napi transparently degrades to a copy — same semantics,
  just not zero-copy.

Why this is sound: after decode the core never mutates or reallocates a column
buffer, so the pointer is stable for the `Arc`'s lifetime; and each buffer is
exported to exactly one view (the Arrow C Data export model), so a JS write
into the view — allowed, TypedArrays are mutable — writes memory nothing on
the Rust side will read again.

The ownership consequence to internalize: **buffer lifetime is per-chunk, not
per-column.** Holding any one view (say, just the `validity` bitmap of one
column) keeps that entire block's `ColBatch` alive. That is the right
trade-off for scan-style consumers, but if you extract a small piece to retain
long-term, copy it out (see "Using it well" below).

## The column shape contract

Every column object carries `name`, `type` (canonical ClickHouse type string,
e.g. `Nullable(DateTime64(3, 'UTC'))`), and `kind` — the dispatch tag (the
_inner_ type for Nullable columns). The buffers depend on `kind`:

| `kind`                                          | Buffers                                                                                        | Notes                                                                                          |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Int8/16/32/64`, `UInt8/16/32/64`, `Float32/64` | `values`                                                                                       | Matching TypedArray; 64-bit kinds are `BigInt64Array`/`BigUint64Array`, so cells are `BigInt`. |
| `Bool`                                          | `bitmap`, `length`                                                                             | Bit-packed, LSB-first: row _i_ is `(bitmap[i >> 3] >> (i & 7)) & 1`.                           |
| `String`                                        | `offsets` (Int32Array, `rowCount + 1` entries, `offsets[0] === 0`), `data` (Uint8Array, UTF-8) | Row _i_'s bytes are `data[offsets[i] .. offsets[i+1]]`. Arrow-style.                           |
| `FixedString`                                   | `data`, `width`                                                                                | Row _i_ is `data[i*width .. (i+1)*width]`, raw bytes (may contain NUL padding).                |
| `Date` / `Date32`                               | `values` (Uint16/Int32)                                                                        | Days since Unix epoch (Date32 may be negative).                                                |
| `DateTime`                                      | `values` (Uint32Array)                                                                         | Seconds since epoch.                                                                           |
| `DateTime64`                                    | `values` (BigInt64Array)                                                                       | Ticks at the column's precision (precision is in `type`).                                      |

Any **Nullable** column additionally carries `validity`: an Arrow-convention
packed bitmap (bit = 1 means valid, bit = 0 means NULL), tested with the same
bit expression as `Bool`. The underlying buffers contain a defined default at
null positions; `validity` is the truth.

Two deliberate choices here:

- **Raw wire values, not JS conveniences.** Temporal columns come out as epoch
  numbers / BigInt ticks, 64-bit ints as BigInt. Converting one million values
  to `Date` objects or strings that the consumer may never look at is exactly
  the per-cell tax this design exists to avoid. Conversion is the consumer's
  call, made lazily.
- **The `kind` match in the binding is exhaustive on purpose** (no `_ =>`
  arm). When the core gains a type, the binding fails to compile until someone
  decides its JS shape. That is a feature.

Wire quirk worth knowing: ClickHouse's HTTP Native output serializes
`DateTime('tz')` columns as bare `DateTime` (the timezone is dropped from the
wire type; `DateTime64` keeps its). The binding reports wire truth, so don't
expect `columnTypes` to always match JSON `meta`.

## The streaming decoder's lifecycle

`NativeStreamDecoder` is the piece that makes the binding fit an HTTP body
stream, and its rules are strict because the failure modes are nasty:

- `push(buf)` decodes every Native block completed by the bytes so far and
  returns them; an incomplete block's bytes are retained inside the core
  (`bufferedBytes` reports how many). Pushes are cheap when no block
  completes (returns empty `chunks`).
- **Schema is captured from the first block, even a zero-row one.** An empty
  result still sends a header-only block, so `columnNames`/`columnTypes`
  populate even when no chunk is ever emitted. Zero-row blocks are dropped
  from `chunks`.
- `finish()` must be called exactly once, after the stream ends. It fails on a
  truncated final block, and on a stream that produced no blocks at all (a
  real Native response always has at least the header block — "no blocks"
  means a dead connection, not an empty result).
- **Errors poison the decoder.** After any decode error, both `push` and
  `finish` fail fast with "create a new NativeStreamDecoder". Continuing would
  rescan the failing buffer on every push (O(n²)) and could silently drop
  rows. Recovery is a new decoder, never a retry on the same one.

Error taxonomy, exposed via the JS `Error`'s `code`:

| `code`           | Meaning                                            | Examples                                                                                     |
| ---------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `InvalidArg`     | The input can _never_ decode — caller/payload bug. | Unsupported type, corrupt framing, mixed-schema blocks, push-after-finish, poisoned decoder. |
| `GenericFailure` | The bytes were plausible but the stream died.      | Truncated tail at `finish()`, stream ended with no blocks.                                   |

A consumer-facing consequence: when a ClickHouse error happens _mid-stream_,
the server has already sent `200 OK` and appends the exception text to the
body. To the decoder that is undecodable trailing bytes — so a decode error on
a 200 response usually _is_ a ClickHouse exception. Wrap the error with that
hint, as the clickhouse-js integration does. To reproduce this path in a test,
use the `throwIf(...) + max_block_size=1 + sleepEachRow` recipe from
`client_native_check.mjs` (with `http_write_exception_in_output_format`
disabled, so the exception arrives as raw appended text).

---

# Using the binding well

## Rule 1: stay columnar as long as you can

The decode-only gap is ~58x; the fully-materialized-rows gap is ~3x. Every JS
object and string you _don't_ create is where the headroom lives. Aggregate,
filter, slice, and feed charting/Arrow-style consumers directly from the
TypedArrays; materialize rows only at the edge that genuinely needs them, and
only the rows that survive.

```js
// Sum a Float64 column across chunks — no rows, no objects, just the buffers
let sum = 0
for (const chunk of result.chunks) {
  const col = chunk.columns[colIdx]
  const v = col.values
  for (let i = 0; i < chunk.rowCount; i++) sum += v[i]
}
```

## Rule 2: build accessors once per column, not per cell

The shape dispatch (`switch (column.kind)`) belongs _outside_ the row loop.
The pattern used by every harness and by the client integration:

```js
function columnAccessor(column) {
  let get
  switch (column.kind) {
    case 'Bool': {
      const bm = column.bitmap
      get = (i) => ((bm[i >> 3] >> (i & 7)) & 1) === 1
      break
    }
    case 'String': {
      // Wrap the bytes in a Buffer ONCE (zero-copy view over the same memory),
      // then use Buffer's fast utf8 slice-decoder per row.
      const data = Buffer.from(
        column.data.buffer,
        column.data.byteOffset,
        column.data.byteLength,
      )
      const offsets = column.offsets
      get = (i) => data.toString('utf8', offsets[i], offsets[i + 1])
      break
    }
    default: {
      const values = column.values
      get = (i) => values[i]
    }
  }
  const v = column.validity
  if (!v) return get
  return (i) => (((v[i >> 3] >> (i & 7)) & 1) === 1 ? get(i) : null)
}
```

Notes baked into that snippet:

- `Buffer.from(arrayBuffer, byteOffset, length)` does **not** copy — it's
  another view. `buffer.toString('utf8', start, end)` is the fastest UTF-8
  range decoder available in Node, faster than `TextDecoder` on a fresh
  `subarray` per row.
- The validity wrapper is only added when the column is Nullable, so
  non-nullable columns pay nothing.

## Rule 3: stream when the source is a stream

Feeding `push()` per HTTP chunk overlaps decode with network time and avoids
holding the whole wire body in memory. At 1M rows this made the end-to-end
columns path ~40% faster than buffer-then-decode. The integration pattern:

```js
const dec = new NativeStreamDecoder()
const chunks = []
let columnNames = [],
  columnTypes = [],
  rowCount = 0
const merge = (out) => {
  if (out.columnNames.length && !columnNames.length) {
    columnNames = out.columnNames
    columnTypes = out.columnTypes
  }
  chunks.push(...out.chunks)
  rowCount += out.rowCount
}
try {
  for await (const buf of httpBody) merge(dec.push(buf))
  merge(dec.finish())
} catch (err) {
  httpBody.destroy() // unconsumed bytes remain — never pool this socket
  throw err
}
```

If you process chunks as they're emitted instead of accumulating, peak memory
stays at roughly one block (`max_block_size` rows), independent of result
size.

## Rule 4: respect the memory model

- A retained view pins its whole chunk. If you keep one small thing past the
  scan — a FixedString cell, one column out of twenty — **copy it**
  (`Buffer.from(view.subarray(...))`, `values.slice()`), so a kilobyte kept
  doesn't pin a 50 MB block. This is why the client's FixedString
  materializer copies.
- Dropping all references frees the Rust memory on the next GC, not
  immediately. That's normal; don't fight it.
- When benchmarking, run Node with `--expose-gc` and call `gc()` between
  samples. Without that, one path's garbage collection lands inside another
  path's timing window — we measured a 10x distortion on the Native decode
  before isolating GC.

## Rule 5: handle the value-semantics differences up front

Coming from the JSON formats, three things look different by design:

- 64-bit integers are `BigInt` (JSON quotes them as strings by default).
- Temporal values are raw epoch numbers / ticks. Conversions:
  `Date/Date32` → `new Date(days * 86400000)`; `DateTime` →
  `new Date(secs * 1000)`; `DateTime64(3)` → `new Date(Number(ticks))`
  (mind the precision in `type` for other scales).
- FixedString is raw bytes (`Buffer`), not a trimmed string — NUL padding is
  preserved, as ClickHouse defines it.

## Reference consumer

The experimental clickhouse-js integration is the worked example of all five
rules: `packages/client-node/src/native_query.ts` (stream decode, abort
hardening, accessors/materializers) and the `queryNativeColumns` /
`queryNativeRows` methods on the Node client. Harnesses in this directory:

| Script                                | What it proves                                                                                           |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `verify.mjs`                          | Decoder correctness vs a JSONCompact oracle, buffered + awkwardly-sliced streaming, all supported types. |
| `zerocopy_check.mjs`                  | Validity + GC survival of retained views (`node --expose-gc`).                                           |
| `nonuniform_check.mjs`                | Mixed-schema payloads throw `InvalidArg`, never abort the process.                                       |
| `client_native_check.mjs`             | The client methods vs a JSONEachRow oracle, plus error/abort paths.                                      |
| `bench_fair.mjs` / `bench_client.mjs` | Apples-to-apples benchmarks (raw transport / real client). Both require `--expose-gc`.                   |

## Build notes

The addon is built with napi-rs 2.x against the `napi6` ABI level — that is
the floor required for `BigInt64Array`/`BigUint64Array` (the `Int64`, `UInt64`
and `DateTime64` columns); everything else in the binding is napi1-level. The
release profile enables LTO with a single codegen unit. The built addon loads
as a plain CommonJS module: `require('./ch-core-js.node')`.
