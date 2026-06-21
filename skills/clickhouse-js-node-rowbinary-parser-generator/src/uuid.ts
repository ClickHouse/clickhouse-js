import { RowBinaryState, advance } from "./core.js";

/**
 * `UUID_HEX16[b]` packs the two lowercase ASCII hex chars of byte `b`, low char
 * in the low byte. Drives the lookup-table UUID formatter {@link formatUUIDTable}.
 */
const UUID_HEX16 = new Uint16Array(256);
for (let b = 0; b < 256; b++) {
  const hex = b.toString(16).padStart(2, "0");
  UUID_HEX16[b] = hex.charCodeAt(0) | (hex.charCodeAt(1) << 8);
}

/**
 * Reusable 36-byte scratch for {@link formatUUIDTable}. The four `-` separators
 * are written once and never touched again; each call overwrites only the 32
 * hex slots, then copies the bytes out as a string.
 */
const UUID_OUT = Buffer.alloc(36);
UUID_OUT[8] = UUID_OUT[13] = UUID_OUT[18] = UUID_OUT[23] = 0x2d; // '-'

/**
 * Read a `UUID`: 16 raw bytes (two little-endian `UInt64` halves on the wire).
 * Returns a zero-copy view; pass it to {@link formatUUID} for the canonical
 * `xxxxxxxx-...` string.
 *
 * The view shares memory with the response buffer, so keeping it alive pins the
 * whole response chunk in memory. If the value must outlive the row/response,
 * copy it with `Buffer.from(...)`.
 *
 * FAST ALTERNATIVE: if you stringify every UUID, format these bytes with
 * {@link formatUUIDTable} (lookup table, no BigInt, ~1.6x faster).
 */
export function readUUID(state: RowBinaryState): Buffer {
  const start = advance(state, 16);
  return state.buf.subarray(start, start + 16);
}

/**
 * Read a `UUID` as a single 128-bit `bigint` (`hi << 64 | lo`) — useful for
 * numeric storage, comparison, or de-duplication without a string.
 *
 * Reads the two halves with `DataView.getBigUint64` rather than
 * `Buffer.readBigUInt64LE`: on V8 the DataView accessors are inlined to a bounds
 * check plus an inline load, measurably faster for 8-byte reads. For the
 * canonical string, use {@link readUUID} with {@link formatUUID}.
 */
export function readUUIDBigInt(state: RowBinaryState): bigint {
  const start = advance(state, 16);
  const hi = state.view.getBigUint64(start, true);
  const lo = state.view.getBigUint64(start + 8, true);
  return (hi << 64n) | lo;
}

/**
 * Read a `UUID` as its two raw little-endian `UInt64` halves, `[hi, lo]` — the
 * faithful wire split with no combining work. Cheaper than {@link readUUIDBigInt}
 * (skips the `hi << 64 | lo`) and a compact key for comparison / de-duplication
 * as two 64-bit values. For the canonical string, use {@link readUUID} with
 * {@link formatUUID} (or {@link formatUUIDTable}).
 */
export function readUUIDHiLo(state: RowBinaryState): [hi: bigint, lo: bigint] {
  const start = advance(state, 16);
  const hi = state.view.getBigUint64(start, true);
  const lo = state.view.getBigUint64(start + 8, true);
  return [hi, lo];
}

/**
 * Format a `UUID` (the raw 16 bytes from {@link readUUID}) as the canonical
 * `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` string.
 *
 * ClickHouse stores a UUID as two little-endian `UInt64` halves (high then
 * low), so each half is byte-reversed relative to the text form. Reading each
 * half with `readBigUInt64LE` undoes that; concatenating high then low yields
 * the 32 canonical hex digits. Kept aside from the read so the hot path can
 * skip stringifying when the raw bytes suffice.
 *
 * FAST ALTERNATIVE: when you format every value, {@link formatUUIDTable} does
 * the same via a byte->hex lookup table with no BigInt (~1.6x faster).
 */
export function formatUUID(b: Buffer): string {
  const hex = ((b.readBigUInt64LE(0) << 64n) | b.readBigUInt64LE(8))
    .toString(16)
    .padStart(32, "0");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Fast {@link formatUUID}: produces the same canonical string, but via a byte ->
 * two-hex-char lookup table (`UUID_HEX16`) written into a reused 36-byte buffer
 * (`UUID_OUT`, dashes preset), with no BigInt and no slicing. Benchmarks ~1.6x
 * faster (see `readUUID.bench.ts`). Takes the raw 16 bytes from {@link readUUID},
 * like formatUUID.
 *
 * The wire is two little-endian `UInt64` halves, each byte-reversed vs the text
 * form, so bytes are emitted high half first in reverse order (`b[7]..b[0]`)
 * then the low half (`b[15]..b[8]`) — the same reordering formatUUID gets from
 * reading each half as a little-endian BigInt.
 *
 * SAFE TO TOGGLE — the opt-in fast formatter, not the default. `UUID_OUT` is
 * shared scratch, so this is NOT reentrant; it is safe for synchronous
 * formatting because the bytes are copied into the returned string before the
 * next call (just don't alias `UUID_OUT` itself). Worth it only when you
 * stringify every UUID; otherwise keep the raw bytes/halves and skip it.
 */
export function formatUUIDTable(b: Buffer): string {
  let p: number;
  // High half: bytes b[7]..b[0] -> hex positions 0..7 (chars 0..15).
  p = UUID_HEX16[b[7]!]!;
  UUID_OUT[0] = p & 0xff;
  UUID_OUT[1] = p >>> 8;
  p = UUID_HEX16[b[6]!]!;
  UUID_OUT[2] = p & 0xff;
  UUID_OUT[3] = p >>> 8;
  p = UUID_HEX16[b[5]!]!;
  UUID_OUT[4] = p & 0xff;
  UUID_OUT[5] = p >>> 8;
  p = UUID_HEX16[b[4]!]!;
  UUID_OUT[6] = p & 0xff;
  UUID_OUT[7] = p >>> 8;
  p = UUID_HEX16[b[3]!]!;
  UUID_OUT[9] = p & 0xff;
  UUID_OUT[10] = p >>> 8;
  p = UUID_HEX16[b[2]!]!;
  UUID_OUT[11] = p & 0xff;
  UUID_OUT[12] = p >>> 8;
  p = UUID_HEX16[b[1]!]!;
  UUID_OUT[14] = p & 0xff;
  UUID_OUT[15] = p >>> 8;
  p = UUID_HEX16[b[0]!]!;
  UUID_OUT[16] = p & 0xff;
  UUID_OUT[17] = p >>> 8;
  // Low half: bytes b[15]..b[8] -> hex positions 8..15 (chars 19..35).
  p = UUID_HEX16[b[15]!]!;
  UUID_OUT[19] = p & 0xff;
  UUID_OUT[20] = p >>> 8;
  p = UUID_HEX16[b[14]!]!;
  UUID_OUT[21] = p & 0xff;
  UUID_OUT[22] = p >>> 8;
  p = UUID_HEX16[b[13]!]!;
  UUID_OUT[24] = p & 0xff;
  UUID_OUT[25] = p >>> 8;
  p = UUID_HEX16[b[12]!]!;
  UUID_OUT[26] = p & 0xff;
  UUID_OUT[27] = p >>> 8;
  p = UUID_HEX16[b[11]!]!;
  UUID_OUT[28] = p & 0xff;
  UUID_OUT[29] = p >>> 8;
  p = UUID_HEX16[b[10]!]!;
  UUID_OUT[30] = p & 0xff;
  UUID_OUT[31] = p >>> 8;
  p = UUID_HEX16[b[9]!]!;
  UUID_OUT[32] = p & 0xff;
  UUID_OUT[33] = p >>> 8;
  p = UUID_HEX16[b[8]!]!;
  UUID_OUT[34] = p & 0xff;
  UUID_OUT[35] = p >>> 8;
  return UUID_OUT.toString("latin1");
}
