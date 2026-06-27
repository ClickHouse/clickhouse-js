---
name: clickhouse-js-node-rowbinary-parser
description: >
  Generate TypeScript/JavaScript code that reads and decodes ClickHouse
  RowBinary streams from the ClickHouse HTTP server.
  Use this skill whenever a user wants to parse `RowBinary`,
  `RowBinaryWithNames`, or `RowBinaryWithNamesAndTypes`.
  Node.js only, doesn't cover browsers.
---

# ClickHouse JS RowBinary Parser Generator for Node.js

## First: is RowBinary even the right format?

RowBinary exists for throughput, but it is **not automatically the fastest
path** — match the format to the shape of the data before committing to a
bespoke parser.

**Prefer a `JSON*` format (e.g. `JSONEachRow`) when** the result is mostly
strings / JSON-like values that you consume wholesale — randomly accessing
essentially every field, running string/regexp methods on them, treating values
as text. V8's native `JSON.parse` is heavily optimized C++ and builds JS strings
and objects faster than a JS-level RowBinary decoder can; pair it with HTTP
response compression (`gzip` / `zstd`, which crushes JSON's repetitive keys) and
the wire cost shrinks too.

**RowBinary clearly wins when** the result is dominated by:

- **Wide numerics** — `Int128`/`Int256`/`UInt128`/`UInt256`,
  `Decimal128`/`Decimal256`.
- **Binary / fixed-width blobs** — `IPv4`, `IPv6`, `UUID`, `FixedString`.
- **High-volume fixed-width numeric columns** generally, where each value is a
  single `DataView` read.

**Prefer the `Native` format when** columnar load and client-side analytics are
the main goal (fold/scan/filter columns, feed typed arrays to a Worker or WASM).
`Native` is column-major, so it loads straight into one typed array per column
with no transpose.

For help choosing and consuming a `JSON*` format (or CSV / TSV) instead, use the
**`clickhouse-js-node-coding`** skill.

## Second: complete buffer, or incremental stream?

Decide this before writing the reader — it changes the shape of the code and is
a real performance fork.

- **Incremental / streaming (the default here).** You consume the HTTP response
  chunk by chunk as it arrives — low latency to the first row, bounded memory.
  It is generally the best choice for large results, but slower per-row.

- **Whole buffer in memory (faster, when it fits).** If you already hold the
  entire response as one `Buffer`, the bounds check never fires — so you can drop
  `advance()` entirely and read at a running offset in one monolithic loop.
  This is 2-3x faster but introduces latency and unbounded memory use.

The exposed API is streaming by default and requires an optimisation pass.

## Third: row objects, or columnar (typed arrays)?

The default output is one object per row (array-of-structs). For a **numeric,
fixed-width result that the consumer reads column-wise**, decode instead into one
typed array per column (struct-of-arrays) — it is **~4x faster and several times
smaller** because it removes the per-row object, `Date`, and number-boxing
allocations that dominate a numeric decode (the byte reads are already at memory
bandwidth). Measured in `tests/iot.columnar.bench.ts`; rationale in
`case-studies/wasm-vs-js.md`.

- **Use columnar when** columns are numeric/fixed-width and the consumer
  aggregates / filters / scans / plots them, or hands the buffers to a Worker or
  WASM kernel (typed-array `ArrayBuffer`s are transferable — zero-copy).
- **The preallocation trick:** if EVERY column is fixed-width the row stride is
  known, so the exact count is `buf.length / stride` — allocate each column once,
  write at `[i]`, no growth, no per-row bounds check.
- **Streaming columnar is just that arithmetic per chunk.** Fixed width means
  honoring a partial buffer needs no `advance()`/`NeedMoreData`/restart: the
  complete-row count is `(chunk.length / stride) | 0`, and the leftover bytes
  carry to the next chunk. Yield one typed-array batch per chunk, each owning a
  fresh transferable `ArrayBuffer` (see `streamSensorColumns` in
  `src/columnar.ts`).
- **Stay row-oriented when** downstream code is row-shaped, the row is
  string-dominated (columnar's win is numeric — a JS string allocates either
  way), or the schema is nested/heterogeneous (`Array`/`Map`/`Tuple`).
- **Hybrid:** store columnar, expose a lazy `rowAt(i)` accessor that builds an
  object only for rows actually touched (see `iotRowAt` in `src/examples/iot.ts`).

## Fourth: are the column types known ahead of time?

- **Known (the default).** Generate a straight-line reader specialized to those
  types — everything below.
- **Only at runtime** (the schema varies, or you just want to decode an arbitrary
  `RowBinaryWithNamesAndTypes` stream). Call
  `compileRowBinaryWithNamesAndTypes(cursor)` (`src/rowBinaryWithNamesAndTypes.ts`):
  it reads the header, folds each column type's AST into a `Reader`
  (`astToReader`, `src/compile.ts`; type strings parsed by
  `@clickhouse/datatype-parser`), and returns a `readRows` driver for the rest of
  the stream. Generic and unoptimized (no codegen), so prefer the specialized
  path whenever the types are fixed.

## Core guidance

When generating a parser, follow these:

- **Little-endian only.** RowBinary is little-endian; target x86/ARM. Read every
  multi-byte number with `DataView` accessors passing a **literal** `true` for
  the `littleEndian` flag.

- **Correct first, then optimize.** First emit a correct reader built from the
  plain per-type API. Only after it's correct (and tested) specialize it. Don't
  bake performance assumptions in before correctness.

- **Monomorphize generic/composite types.** Emit specialized, inlined code per
  type combination instead of passing functions as arguments where the type
  is known ahead of time.

- **Streaming: throw + restart, not generators.** To signal "need more bytes",
  a synchronous reader that throws a sentinel (`NeedMoreData`) and restarts the
  row beats generators for realistic chunk sizes;

- **Keep an eye on chunk sizes.** Partial trailing rows, small chunks are a silent
  throughput killer: `streamRowBatches` warns once when
  rows-per-chunk falls too low, and `coalesceChunks(source, { minSize, timeoutMs })`
  merges small chunks in front of it when the source size isn't yours to raise.

- **Shared scratch is not reentrant.** Some hot methods reuse a module-level
  scratch buffer as a write-then-read pair — correct only because reads are fully
  synchronous. An `async`/`yield` boundary between populating and reading it
  corrupts the value.

- **Hoist the cursor into locals.** Prefer the working buffer and view declared
  once at the top of the generated reader, and keep the read offset in a **local variable**,
  operating on it directly instead of re-reading from an object.

- **Coalesce `advance()` across adjacent fixed-width columns.** A run of
  neighbouring fixed-width columns has a known combined size, so bounds-check it
  ONCE.

- **Inline the leaf reads.** The per-type `readX` functions are the correct,
  composable reference; the generated parser should INLINE their bodies, not call
  them, so the row reader is straight-line with no per-field indirection (and so
  the two points above can fold the offset arithmetic together).

- **Annotate the decoded type per column.** Inlining erases the type structure,
  so put a short comment above each column's decode block naming the ClickHouse
  type it reads.

- **Pre-allocate small result arrays.** RowBinary gives every array/map its
  element count up front (the LEB128 prefix), so DEFAULT is to `new Array(n)`.
  NOTE: for **large** arrays the application will iterate or compute over repeatedly,
  prefer `[]` + `push` (faster to traverse in V8) — or a typed array (`Float64Array`…)
  for numeric elements.

- **TypeScript by default.** Generate TypeScript parsers and helpers unless the
  user explicitly asks for plain JavaScript.

## Type family references

The readers live as real code under `src/`, split by type family.

| Result contains (trigger)                                                                                                                      | Open                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Always** — cursor state, `advance()`, `NeedMoreData`, `Reader<T>`                                                                            | `src/core.ts`                                                                                                                                                         |
| LEB128 length/count prefixes for `String`/`Array`/`Map` (`readUVarint`)                                                                        | `src/varint.ts`                                                                                                                                                       |
| `Int8`–`Int256`, `UInt8`–`UInt256`                                                                                                             | `src/integers.ts`                                                                                                                                                     |
| `Bool`                                                                                                                                         | `src/bool.ts`                                                                                                                                                         |
| `Enum8`, `Enum16`                                                                                                                              | `src/enums.ts`                                                                                                                                                        |
| `Float32`, `Float64`, `BFloat16`                                                                                                               | `src/floats.ts`                                                                                                                                                       |
| `Decimal32/64/128/256`, `Decimal(P, S)`                                                                                                        | `src/decimals.ts`                                                                                                                                                     |
| `String`, `FixedString(N)`                                                                                                                     | `src/strings.ts`                                                                                                                                                      |
| `UUID`                                                                                                                                         | `src/uuid.ts`                                                                                                                                                         |
| `IPv4`, `IPv6`                                                                                                                                 | `src/ip.ts`                                                                                                                                                           |
| `Date`, `Date32`, `DateTime`, `DateTime(tz)`, `DateTime64(P[, tz])`                                                                            | `src/datetime.ts`                                                                                                                                                     |
| `Time`, `Time64(P)`                                                                                                                            | `src/time.ts`                                                                                                                                                         |
| `IntervalNanosecond` … `IntervalYear`                                                                                                          | `src/interval.ts`                                                                                                                                                     |
| `Array(T)`, `Map(K, V)`, `Tuple(...)`, `Nullable(T)`, `Variant(...)`, `QBit(...)`                                                              | `src/composite.ts`                                                                                                                                                    |
| `Point`, `Ring`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `Geometry`                                                        | `src/geo.ts`                                                                                                                                                          |
| `Dynamic` (and `Variant`/`Interval`/`Nested`/`Dynamic` nested inside it)                                                                       | `src/dynamic.ts`                                                                                                                                                      |
| `JSON`                                                                                                                                         | `src/json.ts`                                                                                                                                                         |
| The whole result — loop rows to EOF (`readRows`)                                                                                               | `src/rows.ts`                                                                                                                                                         |
| A chunked HTTP response — `streamRowBatches`, `coalesceChunks`                                                                                 | `src/stream.ts`                                                                                                                                                       |
| The `RowBinaryWithNamesAndTypes` header — column names + type strings (`readHeader`)                                                           | `src/header.ts`                                                                                                                                                       |
| Fold one parsed type AST into a `Reader` (`astToReader`) — AST in, reader out                                                                  | `src/compile.ts`                                                                                                                                                      |
| **Types known only at runtime** — compile a whole header into a row reader (`compileRowBinaryWithNamesAndTypes`, `typeStringToReader`)         | `src/rowBinaryWithNamesAndTypes.ts`                                                                                                                                   |
| **Numeric/fixed-width result read column-wise** (aggregate/scan/plot, hand to a Worker/WASM) → decode into typed arrays, not row objects (~4x) | `src/columnar.ts` (`streamSensorColumns` — streaming, yields transferable typed-array batches); `decodeIotColumnar` in `src/examples/iot.ts` is the whole-buffer form |
| `LowCardinality(T)` — transparent, decode as `T`                                                                                               | `src/lowCardinality.ts`                                                                                                                                               |
| `SimpleAggregateFunction(f, T)` — transparent, decode as `T`                                                                                   | `src/simpleAggregateFunction.ts`                                                                                                                                      |
| `Nested(...)` — no wire of its own; `Array(Tuple(...))`                                                                                        | `src/nested.ts`                                                                                                                                                       |
| `Nothing` — zero-width, never decoded (only wrapped)                                                                                           | `src/nothing.ts`                                                                                                                                                      |
| `AggregateFunction(...)` — opaque state; finalize server-side                                                                                  | `src/aggregateFunction.ts`                                                                                                                                            |

## Worked examples

Six end-to-end examples with real speedup are catalogued in [EXAMPLES.md](EXAMPLES.md).

## Out of scope

- **JSON / CSV / TSV / Parquet parsing** → use `clickhouse-js-node-coding`.
- **Connection errors, hangs, type mismatches** → use
  `clickhouse-js-node-troubleshooting`.
- **Browser / Web Worker / Edge** → `@clickhouse/client-web`.

## Still Stuck?

- [ClickHouse RowBinary format](https://clickhouse.com/docs/interfaces/formats#rowbinary)
- [ClickHouse data types](https://clickhouse.com/docs/sql-reference/data-types)
- [ClickHouse JS client docs](https://clickhouse.com/docs/integrations/javascript)
