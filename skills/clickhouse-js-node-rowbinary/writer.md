# RowBinary writer (encode) for Node.js

Encoding JS values into a `RowBinary` payload to send to ClickHouse. Read
[SKILL.md](SKILL.md) first for the format gate ("is RowBinary even the right
format?") and the principles that apply to **both** directions; this file covers
what's specific to **writing**. Reading? See [reader.md](reader.md).

Each `writeX` encodes one value: it appends that value's RowBinary bytes to a
`Sink` — an object wrapping a byte buffer and the current write offset. Leaf
writers (`writeUInt8`, `writeString`, …) are `Writer<T>` functions with the shape
`(sink, value) => void`. Combinators (`writeArray`, `writeTuple`, …) take
sub-writers and return a `Writer`, so composite types compose with no per-element
closures. Import the barrel as `@clickhouse/rowbinary/writer`, or a per-type
module for just what you need. (Structurally this is the mirror of the decode
side in [reader.md](reader.md), but you don't need the read side to write.)

```ts
const sink = new Sink(Buffer.allocUnsafe(64));
writeUInt8(sink, 255);
sink.bytes(); // the encoded RowBinary
```

## Writer guidance

On top of the shared principles in [SKILL.md](SKILL.md), the write path has its own:

- **Reserve before you write.** `reserve(sink, n)` ensures the sink has room for
  `n` more bytes and returns the offset to write them at; if the buffer can't fit
  them it throws `BufferFull`. Every leaf writer reserves the bytes it needs and
  writes at that returned offset.

- **Coalesce `reserve()` across adjacent fixed-width columns.** A run of
  neighbouring fixed-width columns has a known combined size, so call `reserve()`
  ONCE for the whole run and write each value at a constant offset, rather than
  reserving per column.

- **Hoist the sink buffer/view into locals.** Declare the working buffer and view
  once at the top of the generated writer and keep the write offset in a **local
  variable**, operating on it directly instead of re-reading it from the sink
  object on every write.

- **Stream large results with `writeRows`.** `writeRows(writeRow)` is a
  **streaming generator** over a fixed buffer (`bufferSize`, default 64 KiB), not
  a one-shot `Writer<readonly T[]>`. It yields a batch of whole rows each time
  the buffer fills — rewinding so a half-written row never leaks — and starts a
  fresh buffer for the rest, so a result larger than the buffer (or an unbounded
  row source) streams out chunk by chunk. An oversized row grows the buffer
  (doubling) rather than failing. Per-buffer fill is published on the
  `@clickhouse/rowbinary:writeRows.flush` `node:diagnostics_channel`
  (`FLUSH_CHANNEL_NAME`, `WriteRowsFlush`) for buffer-utilization metrics.

  ```ts
  const writeRow = writeTupleNamed({ id: writeUInt64, name: writeString });
  for (const chunk of writeRows(writeRow)(rows, 64 * 1024)) send(chunk);
  ```

- **No defensive validation on the hot path.** Don't add `isFinite`/`NaN`/range
  checks to `writeX`; the value is assumed correct and an invalid one is a
  programming error — document the precondition in JSDoc instead. Prefer letting
  the ClickHouse server reject bad bytes over guarding client-side. Two narrow
  exceptions: checks that keep the **framing** in sync (`writeIPv6` requires
  exactly 16 bytes, since a wrong length shifts every following field) and
  **zero-cost parse-time helpers** (string → bytes, before anything is on the
  wire — e.g. `parseIPv6` rejecting malformed groups). See [AGENTS.md](AGENTS.md).

- **Floor, don't round, on lossy time conversions.** `writeDate`/`writeDate32`
  floor to the calendar day and `writeDateTime` floors to the whole second, so a
  non-midnight `Date` or sub-second `DateTime` is never rounded up to the wrong
  encoding.

## Writer type family references

The writers live as real code under `src/writers/`, one `*_writer.ts` per type
family.

| Value to encode (trigger)                                                                                                                      | Open                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **Always** — sink state, `reserve()`, `BufferFull`, `Writer<T>`                                                                                | `src/writers/core_writer.ts`                  |
| LEB128 length/count prefixes for `String`/`Array`/`Map` (`writeUVarint`)                                                                       | `src/writers/varint_writer.ts`                |
| `Int8`–`Int256`, `UInt8`–`UInt256`                                                                                                             | `src/writers/integers_writer.ts`              |
| `Bool` (`writeBool`)                                                                                                                           | `src/writers/bool_writer.ts`                  |
| `Enum8`, `Enum16` (`writeEnum8`/`writeEnum16`; pass the raw int)                                                                               | `src/writers/enums_writer.ts`                 |
| `Float32`, `Float64`, `BFloat16`                                                                                                               | `src/writers/floats_writer.ts`                |
| `Decimal32/64/128/256`, `Decimal(P, S)` (`parseDecimal`)                                                                                       | `src/writers/decimals_writer.ts`              |
| `String`, `FixedString(N)` (`writeString`/`writeStringBytes`/`writeFixedString`)                                                               | `src/writers/strings_writer.ts`               |
| `UUID` (`writeUUID`, `parseUUID`)                                                                                                              | `src/writers/uuid_writer.ts`                  |
| `IPv4`, `IPv6` (`writeIPv4`/`writeIPv6`, `parseIPv4`/`parseIPv6`)                                                                              | `src/writers/ip_writer.ts`                    |
| `Date`, `Date32`, `DateTime`, `DateTime(tz)`, `DateTime64(P[, tz])`                                                                            | `src/writers/datetime_writer.ts`              |
| `Time`, `Time64(P)` (`parseTime`/`parseTime64`)                                                                                                | `src/writers/time_writer.ts`                  |
| `IntervalNanosecond` … `IntervalYear`                                                                                                          | `src/writers/interval_writer.ts`              |
| `Array(T)`, `Map(K, V)`, `Tuple(...)`, `Nullable(T)`, `Variant(...)`, `QBit(...)`                                                              | `src/writers/composite_writer.ts`             |
| `Point`, `Ring`, `LineString`, `MultiLineString`, `Polygon`, `MultiPolygon`, `Geometry`                                                        | `src/writers/geo_writer.ts`                   |
| The whole result — write rows from a value source (`writeRows`)                                                                                | `src/writers/rows_writer.ts`                  |
| `LowCardinality(T)` — transparent, encode as `T`                                                                                               | `src/writers/lowCardinality_writer.ts`        |
| `SimpleAggregateFunction(f, T)` — transparent, encode as `T`                                                                                   | `src/writers/simpleAggregateFunction_writer.ts` |
| `Nested(...)` — no wire of its own; `Array(Tuple(...))`                                                                                        | `src/writers/nested_writer.ts`                |
| `Nothing` — zero-width, never encoded (only wrapped)                                                                                           | `src/writers/nothing_writer.ts`               |
| `AggregateFunction(...)` — opaque state; produce server-side                                                                                   | `src/writers/aggregateFunction_writer.ts`     |

**No writer counterpart yet** — these reader paths are decode-only for now:
`dynamic.ts`, `json.ts`, `stream.ts`, the `RowBinaryWithNamesAndTypes`
header/compile/runtime path (`header.ts`, `compile.ts`,
`rowBinaryWithNamesAndTypes.ts`), and the columnar typed-array path
(`columnar.ts`). The AST-based dynamic encode path is intentionally not built.
