# RowBinary writer — TODO

The package ships a complete RowBinary **reader** (decode). This is the plan for
the matching **writer** (encode), mirroring the reader module-for-module: every
`readX` gets a `writeX` counterpart that appends the value's RowBinary bytes to a
fixed-length output buffer (`Sink`), and each writer lands in its own commit with
a round-trip test against a live ClickHouse server.

## Design

- `Sink` is the write-side mirror of the reader's `Cursor`: it wraps a
  caller-supplied, FIXED-length `Buffer` + `DataView` and a write position.
  `reserve(sink, n)` is the mirror of `advance(state, n)` — it bounds-checks the
  next `n` bytes, advances the position, and returns the offset the write starts
  at. Just as `advance` throws `NeedMoreData` on underflow, `reserve` throws
  `NeedMoreSpace` on overflow (the buffer is not grown); a driver flushes the
  bytes written so far and continues into a fresh buffer. `sink.bytes()` returns
  the written slice.
- `Writer<T> = (sink: Sink, value: T) => void` is the mirror of `Reader<T>`.
- Combinators mirror the reader's: `writeArray(writeElement)`,
  `writeNullable(writeValue)`, etc. take sub-writers and return a `Writer`.
- The readers stay untouched in their per-type modules; each writer lands in a
  parallel `*_writer.ts` module (`core_writer.ts`, `integers_writer.ts`, …) and
  `writer.ts` is the barrel mirror of `reader.ts`.

## Out of scope (for now)

- The **dynamic AST-based compile** path: `compile.ts` (`astToReader`),
  `header.ts`, `rowBinaryWithNamesAndTypes.ts`, and the self-describing
  `dynamic.ts` / `json.ts` writers (writing those requires inferring a ClickHouse
  type from a JS value, the encode-side equivalent of the AST compile).
- The **skill** docs (`SKILL.md`, `README.md`, `EXAMPLES.md`, case studies) and
  example readers under `src/examples/`.

## Types / writers

- [x] **core** — `Sink`, `Writer<T>`, `reserve`, `Sink.bytes()`; `writer.ts` barrel
- [x] **varint** — `writeUVarint`
- [x] **integers** — `writeUInt8`..`writeUInt256`, `writeInt8`..`writeInt256`
- [x] **bool** — `writeBool`
- [x] **enums** — `writeEnum8`, `writeEnum16`
- [x] **floats** — `writeFloat32`, `writeFloat64`, `writeBFloat16`
- [x] **decimals** — `writeDecimal32`/`64`/`128`/`256`
- [x] **strings** — `writeString`, `writeFixedString`, `writeFixedStringBytes`
- [x] **uuid** — `writeUUID`, `writeUUIDBigInt`, `writeUUIDHiLo`, `parseUUID`
- [x] **ip** — `writeIPv4`, `writeIPv6`, `parseIPv4`, `parseIPv6`
- [x] **datetime** — `writeDate`, `writeDate32`, `writeDateTime`, `writeDateTime64`(+`P3`/`P6`/`P9`)
- [x] **time** — `writeTime`, `writeTime64`
- [x] **interval** — `writeInterval`
- [x] **composite** — `writeNullable`, `writeArray`, `writeQBit`, `writeTuple`, `writeTupleNamed`, `writeMap`, `writeVariant`
- [x] **rows** — `writeRows`
- [x] **geo** — `writePoint`, `writeRing`, `writeLineString`, `writePolygon`, `writeMultiLineString`, `writeMultiPolygon`, `writeGeometry`
- [x] **lowCardinality** — `writeLowCardinality`
- [x] **simpleAggregateFunction** — `writeSimpleAggregateFunction`
- [x] **nested** — `writeNested`
- [x] **nothing** — `writeNothing`
- [x] **aggregateFunction** — `writeAggregateFunction`
