import { Sink, reserve } from "./core_writer.js";

/**
 * Write a LEB128 unsigned varint — the encode mirror of `readUVarint` (used for
 * string/array/map lengths).
 *
 * Takes a JS `number`, so it is NOT bigint-friendly: the value MUST be a
 * non-negative integer no larger than `Number.MAX_SAFE_INTEGER` (2^53 - 1). That
 * precondition is NOT checked here — at this level the data is expected to be
 * correct (a length the encoder itself produced), and an out-of-range value is a
 * programming error the server will reject. If you genuinely need lengths beyond
 * 2^53, write a bigint version with a bigint accumulator instead of widening this
 * one.
 *
 * The loop uses `/` and `%` (not `>>>`/`&`): JS bitwise operators are 32-bit and
 * would corrupt values past bit 31, exactly as the reader multiplies rather than
 * shifts. Each output byte carries 7 payload bits low-first, with the high
 * continuation bit set while more bits remain; the overwhelmingly common 1-2 byte
 * case costs one or two iterations.
 *
 * The byte count is computed up front so the whole number is {@link reserve}d
 * once, then the bytes are written into the reserved span by index.
 */
export function writeUVarint(sink: Sink, value: number): void {
  let size = 1;
  for (let v = value; v >= 0x80; v = Math.floor(v / 128)) size++;
  const o = reserve(sink, size);
  let v = value;
  let i = 0;
  while (v >= 0x80) {
    sink.buf[o + i++] = (v % 128) | 0x80;
    v = Math.floor(v / 128);
  }
  sink.buf[o + i] = v;
}
