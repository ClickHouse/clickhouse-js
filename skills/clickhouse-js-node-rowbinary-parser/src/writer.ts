/**
 * Barrel re-export of the RowBinary WRITER — the encode mirror of `reader.ts`,
 * split by type family across parallel `*_writer.ts` modules (the readers stay in
 * their own files untouched). Import from here for everything in one place, or
 * from a specific module (e.g. `./integers_writer.js`, `./strings_writer.js`) to
 * pull in only the sub-writers a given result needs — the latter is what a
 * generated encoder should do, copying just the modules its column types require.
 *
 * Each `writeX` is the inverse of the matching `readX`: it appends the value's
 * RowBinary bytes to a {@link Sink} (the write-side mirror of the reader's
 * `Cursor`). Leaf writers are `Writer<T>`s directly; combinators (e.g.
 * `writeArray`) take sub-writers and return a `Writer`, so types compose with no
 * per-element closures — exactly like the reader combinators.
 *
 *   const sink = new Sink(Buffer.allocUnsafe(64));
 *   writeUInt8(sink, 255);
 *   sink.bytes(); // the encoded RowBinary
 *
 * - core_writer — Sink, Writer<T>, reserve (mirror of Cursor, Reader<T>, advance)
 * - varint_writer — writeUVarint
 *
 * The dynamic AST-based encode path (the inverse of `compile.ts` /
 * `rowBinaryWithNamesAndTypes.ts` / `dynamic.ts`) is intentionally NOT part of
 * this barrel yet.
 */
export { Sink, reserve, BufferFull, type Writer } from "./core_writer.js";
export { writeUVarint } from "./varint_writer.js";
export {
  writeUInt8,
  writeInt8,
  writeUInt16,
  writeInt16,
  writeUInt32,
  writeInt32,
  writeUInt64,
  writeInt64,
  writeUInt128,
  writeInt128,
  writeUInt256,
  writeInt256,
} from "./integers_writer.js";
export { writeBool } from "./bool_writer.js";
export { writeEnum8, writeEnum16 } from "./enums_writer.js";
export { writeFloat32, writeFloat64, writeBFloat16 } from "./floats_writer.js";
export {
  writeDecimal32,
  writeDecimal64,
  writeDecimal128,
  writeDecimal256,
  parseDecimal,
} from "./decimals_writer.js";
export {
  writeString,
  writeStringBytes,
  writeFixedString,
  writeFixedStringBytes,
} from "./strings_writer.js";
export {
  writeUUID,
  writeUUIDBigInt,
  writeUUIDHiLo,
  parseUUID,
} from "./uuid_writer.js";
export { writeIPv4, writeIPv6, parseIPv4, parseIPv6 } from "./ip_writer.js";
export {
  writeDate,
  writeDate32,
  writeDateTime,
  writeDateTime64,
  writeDateTime64P3,
  writeDateTime64P6,
  writeDateTime64P9,
} from "./datetime_writer.js";
export {
  writeTime,
  writeTime64,
  parseTime,
  parseTime64,
} from "./time_writer.js";
export { writeInterval } from "./interval_writer.js";
export {
  writeNullable,
  writeArray,
  writeQBit,
  writeTuple,
  writeTupleNamed,
  writeMap,
  writeVariant,
  type VariantValue,
} from "./composite_writer.js";
export {
  writeRows,
  FLUSH_CHANNEL_NAME,
  type WriteRowsFlush,
} from "./rows_writer.js";
export {
  writePoint,
  writeRing,
  writeLineString,
  writePolygon,
  writeMultiLineString,
  writeMultiPolygon,
  writeGeometry,
  type GeometryValue,
} from "./geo_writer.js";
export { writeLowCardinality } from "./lowCardinality_writer.js";
export { writeSimpleAggregateFunction } from "./simpleAggregateFunction_writer.js";
export { writeNested } from "./nested_writer.js";
export { writeNothing } from "./nothing_writer.js";
export { writeAggregateFunction } from "./aggregateFunction_writer.js";
