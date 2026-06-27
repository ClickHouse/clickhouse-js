import { Cursor, advance, Sink, reserve } from "./core.js";

/** Read a single unsigned byte and advance. */
export function readUInt8(state: Cursor): number {
  return state.buf[advance(state, 1)]!;
}

/** Read an `Int8`: 1 byte, two's-complement signed (-128 .. 127). */
export function readInt8(state: Cursor): number {
  return state.view.getInt8(advance(state, 1));
}

/** Read a `UInt16`: 2 bytes, little-endian (0 .. 65535). */
export function readUInt16(state: Cursor): number {
  return state.view.getUint16(advance(state, 2), true);
}

/**
 * Read an `Int16`: 2 bytes, little-endian, two's-complement signed (-32768 ..
 * 32767). `DataView` reads from any offset and decodes explicitly little-endian,
 * so the value never depends on host byte order.
 */
export function readInt16(state: Cursor): number {
  return state.view.getInt16(advance(state, 2), true);
}

/** Read a `UInt32`: 4 bytes, little-endian (0 .. 4294967295). */
export function readUInt32(state: Cursor): number {
  return state.view.getUint32(advance(state, 4), true);
}

/** Read an `Int32`: 4 bytes, little-endian, two's-complement signed. */
export function readInt32(state: Cursor): number {
  return state.view.getInt32(advance(state, 4), true);
}

/**
 * Read a `UInt64`: 8 bytes, little-endian. Returns a `bigint`.
 * SAFE TO TOGGLE: if the values fit in 53 bits, wrap in `Number(...)`.
 */
export function readUInt64(state: Cursor): bigint {
  return state.view.getBigUint64(advance(state, 8), true);
}

/**
 * Read an `Int64`: 8 bytes, little-endian, two's-complement. Returns a `bigint`
 * (range exceeds `Number.MAX_SAFE_INTEGER`).
 * SAFE TO TOGGLE: if the values fit in 53 bits, wrap in `Number(...)`.
 */
export function readInt64(state: Cursor): bigint {
  return state.view.getBigInt64(advance(state, 8), true);
}

/** Read a `UInt128`: 16 bytes, little-endian. Always a `bigint`. */
export function readUInt128(state: Cursor): bigint {
  const start = advance(state, 16);
  const lo = state.view.getBigUint64(start, true);
  const hi = state.view.getBigUint64(start + 8, true);
  return (hi << 64n) + lo;
}

/**
 * Read an `Int128`: 16 bytes, little-endian, two's-complement. Always a
 * `bigint`, composed from the low (unsigned) and high (signed) 64-bit words —
 * reading the high word signed extends the sign across all 128 bits.
 */
export function readInt128(state: Cursor): bigint {
  const start = advance(state, 16);
  const lo = state.view.getBigUint64(start, true);
  const hi = state.view.getBigInt64(start + 8, true);
  return (hi << 64n) + lo;
}

/** Read a `UInt256`: 32 bytes, little-endian. Always a `bigint`. */
export function readUInt256(state: Cursor): bigint {
  const start = advance(state, 32);
  const w0 = state.view.getBigUint64(start, true);
  const w1 = state.view.getBigUint64(start + 8, true);
  const w2 = state.view.getBigUint64(start + 16, true);
  const w3 = state.view.getBigUint64(start + 24, true);
  return w0 + (w1 << 64n) + (w2 << 128n) + (w3 << 192n);
}

/**
 * Read an `Int256`: 32 bytes, little-endian, two's-complement. Always a
 * `bigint`. The most-significant 64-bit word is read signed.
 */
export function readInt256(state: Cursor): bigint {
  const start = advance(state, 32);
  const w0 = state.view.getBigUint64(start, true);
  const w1 = state.view.getBigUint64(start + 8, true);
  const w2 = state.view.getBigUint64(start + 16, true);
  const w3 = state.view.getBigInt64(start + 24, true);
  return (w3 << 192n) + (w2 << 128n) + (w1 << 64n) + w0;
}

// --- Writers: the encode mirror of the readers above. Each writeX is the
// inverse of the matching readX. Reserve the offset FIRST, then index
// sink.buf/sink.view — a grow inside reserve() swaps both out (see reserve()).

/** Write a `UInt8`: 1 byte (0 .. 255). Mirror of {@link readUInt8}. */
export function writeUInt8(sink: Sink, value: number): void {
  const o = reserve(sink, 1);
  sink.buf[o] = value;
}

/** Write an `Int8`: 1 byte, two's-complement signed (-128 .. 127). Mirror of {@link readInt8}. */
export function writeInt8(sink: Sink, value: number): void {
  sink.view.setInt8(reserve(sink, 1), value);
}

/** Write a `UInt16`: 2 bytes, little-endian. Mirror of {@link readUInt16}. */
export function writeUInt16(sink: Sink, value: number): void {
  sink.view.setUint16(reserve(sink, 2), value, true);
}

/** Write an `Int16`: 2 bytes, little-endian, two's-complement. Mirror of {@link readInt16}. */
export function writeInt16(sink: Sink, value: number): void {
  sink.view.setInt16(reserve(sink, 2), value, true);
}

/** Write a `UInt32`: 4 bytes, little-endian. Mirror of {@link readUInt32}. */
export function writeUInt32(sink: Sink, value: number): void {
  sink.view.setUint32(reserve(sink, 4), value, true);
}

/** Write an `Int32`: 4 bytes, little-endian, two's-complement. Mirror of {@link readInt32}. */
export function writeInt32(sink: Sink, value: number): void {
  sink.view.setInt32(reserve(sink, 4), value, true);
}

/**
 * Write a `UInt64`: 8 bytes, little-endian. Takes a `bigint` (mirror of
 * {@link readUInt64}). `setBigUint64` requires a value in [0, 2^64); pass
 * `BigInt(n)` for a plain number.
 */
export function writeUInt64(sink: Sink, value: bigint): void {
  sink.view.setBigUint64(reserve(sink, 8), value, true);
}

/**
 * Write an `Int64`: 8 bytes, little-endian, two's-complement. Takes a `bigint`
 * (mirror of {@link readInt64}).
 */
export function writeInt64(sink: Sink, value: bigint): void {
  sink.view.setBigInt64(reserve(sink, 8), value, true);
}

/**
 * Write a `UInt128`/`Int128`: 16 bytes, little-endian, as two 64-bit words (low
 * then high). `BigInt.asUintN(64, ...)` reduces each word to the unsigned
 * representation `setBigUint64` needs, which also yields the correct two's
 * complement for a negative (signed) value — so this one function serves both
 * {@link readUInt128} and {@link readInt128}.
 */
export function writeUInt128(sink: Sink, value: bigint): void {
  const o = reserve(sink, 16);
  sink.view.setBigUint64(o, BigInt.asUintN(64, value), true);
  sink.view.setBigUint64(o + 8, BigInt.asUintN(64, value >> 64n), true);
}

/** Write an `Int128`: 16 bytes LE two's-complement. Same word layout as {@link writeUInt128}. */
export const writeInt128 = writeUInt128;

/**
 * Write a `UInt256`/`Int256`: 32 bytes, little-endian, as four 64-bit words
 * (least-significant first). Like {@link writeUInt128}, `BigInt.asUintN(64, ...)`
 * per word handles both unsigned and signed (two's complement) values.
 */
export function writeUInt256(sink: Sink, value: bigint): void {
  const o = reserve(sink, 32);
  sink.view.setBigUint64(o, BigInt.asUintN(64, value), true);
  sink.view.setBigUint64(o + 8, BigInt.asUintN(64, value >> 64n), true);
  sink.view.setBigUint64(o + 16, BigInt.asUintN(64, value >> 128n), true);
  sink.view.setBigUint64(o + 24, BigInt.asUintN(64, value >> 192n), true);
}

/** Write an `Int256`: 32 bytes LE two's-complement. Same word layout as {@link writeUInt256}. */
export const writeInt256 = writeUInt256;
