# RowBinary writer — TODO

The package ships a complete RowBinary **reader** (decode). This is the plan for
the matching **writer** (encode), mirroring the reader module-for-module: every
`readX` gets a `writeX` counterpart that appends the value's RowBinary bytes to a
growable output buffer (`Sink`), and each writer lands in its own commit with a
round-trip test against a live ClickHouse server.

## Design

- `Sink` is the write-side mirror of the reader's `Cursor`: it owns a growable
  `Buffer` + `DataView` and a write position. `reserve(sink, n)` is the mirror of
  `advance(state, n)` — it grows the buffer if needed, advances the position, and
  returns the offset the write starts at. `sink.bytes()` returns the written
  slice.
- `Writer<T> = (sink: Sink, value: T) => void` is the mirror of `Reader<T>`.
- Combinators mirror the reader's: `writeArray(writeElement)`,
  `writeNullable(writeValue)`, etc. take sub-writers and return a `Writer`.
- Writers live next to their readers in the same per-type modules; `writer.ts` is
  the barrel mirror of `reader.ts`.

## Out of scope (for now)

- The **dynamic AST-based compile** path: `compile.ts` (`astToReader`),
  `header.ts`, `rowBinaryWithNamesAndTypes.ts`, and the self-describing
  `dynamic.ts` / `json.ts` writers (writing those requires inferring a ClickHouse
  type from a JS value, the encode-side equivalent of the AST compile).
- The **skill** docs (`SKILL.md`, `README.md`, `EXAMPLES.md`, case studies) and
  example readers under `src/examples/`.

## Types / writers

- [ ] **core** — `Sink`, `Writer<T>`, `reserve`, `Sink.bytes()`; `writer.ts` barrel
- [ ] **varint** — `writeUVarint`
- [ ] **integers** — `writeUInt8`..`writeUInt256`, `writeInt8`..`writeInt256`
- [ ] **bool** — `writeBool`
- [ ] **enums** — `writeEnum8`, `writeEnum16`
- [ ] **floats** — `writeFloat32`, `writeFloat64`, `writeBFloat16`
- [ ] **decimals** — `writeDecimal32`/`64`/`128`/`256`
- [ ] **strings** — `writeString`, `writeFixedString`, `writeFixedStringBytes`
- [ ] **uuid** — `writeUUID`, `writeUUIDBigInt`, `writeUUIDHiLo`, `parseUUID`
- [ ] **ip** — `writeIPv4`, `writeIPv6`, `parseIPv4`, `parseIPv6`
- [ ] **datetime** — `writeDate`, `writeDate32`, `writeDateTime`, `writeDateTime64`(+`P3`/`P6`/`P9`)
- [ ] **time** — `writeTime`, `writeTime64`
- [ ] **interval** — `writeInterval`
- [ ] **composite** — `writeNullable`, `writeArray`, `writeQBit`, `writeTuple`, `writeTupleNamed`, `writeMap`, `writeVariant`
- [ ] **rows** — `writeRows`
- [ ] **geo** — `writePoint`, `writeRing`, `writeLineString`, `writePolygon`, `writeMultiLineString`, `writeMultiPolygon`, `writeGeometry`
- [ ] **lowCardinality** — `writeLowCardinality`
- [ ] **simpleAggregateFunction** — `writeSimpleAggregateFunction`
- [ ] **nested** — `writeNested`
- [ ] **nothing** — `writeNothing`
- [ ] **aggregateFunction** — `writeAggregateFunction`
