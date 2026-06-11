import type { ResponseHeaders } from '@clickhouse/client-common'
import { createRequire } from 'node:module'
import Path from 'node:path'
import type Stream from 'stream'

/** Typed-array buffer carrying the values of a fixed-width column. */
export type NativeValuesArray =
  | Int8Array
  | Int16Array
  | Int32Array
  | BigInt64Array
  | Uint8Array
  | Uint16Array
  | Uint32Array
  | BigUint64Array
  | Float32Array
  | Float64Array

/** A single column of a decoded Native block, as exported by the ch-core-js addon.
 *  Buffers are zero-copy views over Rust-owned memory (kept alive until GC).
 *
 *  Shape depends on {@link kind}:
 *  - `Bool`: packed `bitmap` (bit=1 is true) + `length`
 *  - `String`: `offsets` (rowCount+1 entries) + utf8 `data`
 *  - `FixedString`: `data` (rowCount * width bytes) + `width`
 *  - everything else: `values` typed array; 64-bit kinds are BigInt arrays;
 *    temporal kinds carry raw wire values (Date/Date32: days since epoch,
 *    DateTime: seconds since epoch, DateTime64: BigInt ticks at the column's precision)
 *
 *  Nullable columns additionally carry an Arrow-style packed `validity`
 *  bitmap: bit=1 means valid, bit=0 means null. */
export interface NativeColumn {
  name: string
  type: string
  kind: string
  values?: NativeValuesArray
  offsets?: Int32Array
  data?: Uint8Array
  bitmap?: Uint8Array
  length?: number
  width?: number
  validity?: Uint8Array
}

/** One decoded Native block: columns share the same rowCount. */
export interface NativeChunk {
  rowCount: number
  columns: NativeColumn[]
}

/** The decoded result of a complete Native stream. */
export interface DecodedNativeResult {
  chunks: NativeChunk[]
  columnNames: string[]
  columnTypes: string[]
  rowCount: number
}

/** Result of {@link NodeClickHouseClient.queryNativeColumns}. */
export interface QueryNativeColumnsResult extends DecodedNativeResult {
  query_id: string
  response_headers: ResponseHeaders
}

/** Result of {@link NodeClickHouseClient.queryNativeRows}.
 *
 *  Values are fully materialized JS values with Native semantics:
 *  64-bit integers are BigInt (JSON formats quote them as strings),
 *  temporal columns carry raw wire values (see {@link NativeColumn}),
 *  FixedString cells are Buffers. */
export interface QueryNativeRowsResult {
  rows: Array<Record<string, unknown>> | Array<Array<unknown>>
  columnNames: string[]
  columnTypes: string[]
  rowCount: number
  query_id: string
  response_headers: ResponseHeaders
}

interface NativeStreamDecoderInstance {
  push(buf: Buffer): DecodedNativeResult
  finish(): DecodedNativeResult
  readonly rowCount: number
  readonly bufferedBytes: number
}

interface ChCoreAddon {
  decodeNativeColumns(buf: Buffer): DecodedNativeResult
  NativeStreamDecoder: new () => NativeStreamDecoderInstance
}

let addon: ChCoreAddon | undefined

/** Lazily load the ch-core-js N-API addon. Regular client usage never calls
 *  this; only the experimental queryNative* methods do. Callers should invoke
 *  this BEFORE sending the query, so a missing addon fails fast locally
 *  instead of after the server has already done the work. */
export function loadAddon(): ChCoreAddon {
  if (addon === undefined) {
    // Default resolves to <repo root>/ch-core-js from both src/ and dist/
    // (POC layout; a packaged release would ship a prebuilt binary instead).
    const addonPath =
      process.env['CH_CORE_JS_ADDON_PATH'] ??
      Path.resolve(__dirname, '../../../ch-core-js/ch-core-js.node')
    const requireAddon = createRequire(__filename)
    try {
      addon = requireAddon(addonPath) as ChCoreAddon
    } catch (err) {
      throw new Error(
        `Failed to load the ch-core-js native addon from "${addonPath}". ` +
          'Build it first (npm run build in ch-core-js), or set ' +
          'CH_CORE_JS_ADDON_PATH to the built .node file. ' +
          `Cause: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      )
    }
  }
  return addon
}

/** Append a `FORMAT Native` clause to a statement, stripping any trailing
 *  semicolons first (a semicolon after the FORMAT clause would be a syntax
 *  error, and `exec` only strips semis at the very end of the final string).
 *  The clause goes on its own line so a trailing `-- comment` in the query
 *  cannot swallow it (same reason the regular query path uses `\nFORMAT`). */
export function appendFormatNative(query: string): string {
  let q = query.trim()
  while (q.endsWith(';')) {
    q = q.slice(0, -1).trimEnd()
  }
  return `${q} \nFORMAT Native`
}

/** Decode a `FORMAT Native` response body stream via the Rust addon.
 *
 *  Abort handling is done here because the connection layer removes its own
 *  abort-signal bridge as soon as response headers arrive — without this
 *  listener, aborting after headers would leave the body stream (and this
 *  loop) running to completion. The pre-loop check covers signals that are
 *  already aborted, since 'abort' listeners never fire for those. */
export async function decodeNativeStream(
  stream: Stream.Readable,
  abort_signal?: AbortSignal,
): Promise<DecodedNativeResult> {
  let chCore: ChCoreAddon
  try {
    chCore = loadAddon()
  } catch (err) {
    // The response stream is already open at this point — don't leak it.
    stream.destroy()
    throw err
  }
  const decoder = new chCore.NativeStreamDecoder()
  const chunks: NativeChunk[] = []
  let columnNames: string[] = []
  let columnTypes: string[] = []
  let rowCount = 0

  const makeAbortError = () =>
    new Error('The user aborted a request (abort_signal)')

  if (abort_signal?.aborted) {
    stream.destroy()
    throw makeAbortError()
  }
  const onAbort = () => {
    stream.destroy(makeAbortError())
  }
  abort_signal?.addEventListener('abort', onAbort, { once: true })

  const merge = (out: DecodedNativeResult) => {
    if (out.columnNames.length > 0 && columnNames.length === 0) {
      columnNames = out.columnNames
      columnTypes = out.columnTypes
    }
    chunks.push(...out.chunks)
    rowCount += out.rowCount
  }

  try {
    for await (const buf of stream) {
      merge(decoder.push(buf as Buffer))
    }
    merge(decoder.finish())
  } catch (err) {
    // Unconsumed bytes remain on the socket — close it instead of returning
    // it to the keep-alive pool.
    if (!stream.destroyed) {
      stream.destroy()
    }
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'InvalidArg' || code === 'GenericFailure') {
      // ClickHouse appends exception text to an already-started 200 OK body;
      // the decoder sees it as undecodable trailing bytes.
      throw new Error(
        `Failed to decode FORMAT Native stream: ${err instanceof Error ? err.message : String(err)}. ` +
          'If the HTTP response was 200 OK, this is possibly a ClickHouse ' +
          'exception emitted mid-stream (check the server logs / query_id).',
        { cause: err },
      )
    }
    throw err
  } finally {
    abort_signal?.removeEventListener('abort', onAbort)
  }

  return { chunks, columnNames, columnTypes, rowCount }
}

type CellGetter = (rowIndex: number) => unknown

/** Build a per-row value getter for one column. Hot path: the shape switch
 *  happens once per column, not once per cell. */
function columnAccessor(column: NativeColumn): CellGetter {
  let get: CellGetter
  switch (column.kind) {
    case 'Bool': {
      const bitmap = column.bitmap as Uint8Array
      get = (i) => ((bitmap[i >> 3] >> (i & 7)) & 1) === 1
      break
    }
    case 'String': {
      const raw = column.data as Uint8Array
      const data = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength)
      const offsets = column.offsets as Int32Array
      get = (i) => data.toString('utf8', offsets[i], offsets[i + 1])
      break
    }
    case 'FixedString': {
      const data = column.data as Uint8Array
      const width = column.width as number
      // Copy: a subarray view would pin the whole Rust-owned chunk in memory.
      get = (i) => Buffer.from(data.subarray(i * width, (i + 1) * width))
      break
    }
    default: {
      const values = column.values as NativeValuesArray
      get = (i) => values[i]
    }
  }
  const validity = column.validity
  if (!validity) {
    return get
  }
  return (i) => (((validity[i >> 3] >> (i & 7)) & 1) === 1 ? get(i) : null)
}

/** Fully materialize decoded chunks into arrays of JS values (one per row). */
export function chunksToRowArrays(
  chunks: NativeChunk[],
): Array<Array<unknown>> {
  const rows: Array<Array<unknown>> = []
  for (const chunk of chunks) {
    const gets = chunk.columns.map(columnAccessor)
    const width = gets.length
    for (let i = 0; i < chunk.rowCount; i++) {
      const row = new Array<unknown>(width)
      for (let j = 0; j < width; j++) {
        row[j] = gets[j](i)
      }
      rows.push(row)
    }
  }
  return rows
}

/** Fully materialize decoded chunks into objects keyed by column name. */
export function chunksToRowObjects(
  chunks: NativeChunk[],
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = []
  for (const chunk of chunks) {
    const gets = chunk.columns.map(columnAccessor)
    const names = chunk.columns.map((c) => c.name)
    const width = gets.length
    // A column literally named __proto__ would hit the prototype setter on
    // plain assignment (silently dropping the value); take the slow
    // defineProperty path only in that case.
    const hasProtoKey = names.includes('__proto__')
    for (let i = 0; i < chunk.rowCount; i++) {
      const row: Record<string, unknown> = {}
      if (hasProtoKey) {
        for (let j = 0; j < width; j++) {
          Object.defineProperty(row, names[j], {
            value: gets[j](i),
            enumerable: true,
            writable: true,
            configurable: true,
          })
        }
      } else {
        for (let j = 0; j < width; j++) {
          row[names[j]] = gets[j](i)
        }
      }
      rows.push(row)
    }
  }
  return rows
}
