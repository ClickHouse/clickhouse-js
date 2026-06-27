import { type Reader, type Writer, Cursor, advance, Sink, reserve } from "./core.js";
import { readUVarint } from "./varint.js";
import { writeUVarint } from "./varint.js";

/**
 * Read a `String`: a varint byte-length prefix followed by that many bytes,
 * decoded as UTF-8.
 *
 * NOTE: ClickHouse `String` is arbitrary bytes, not guaranteed UTF-8. For binary
 * columns, read `state.buf.subarray(start, start + len)` and skip the decode to
 * keep the raw bytes.
 */
export function readString(state: Cursor): string {
  const len = readUVarint(state);
  const start = advance(state, len);
  return state.buf.toString("utf8", start, start + len);
}

/**
 * Read a `FixedString(N)`: exactly `size` raw bytes, decoded as UTF-8. Curried:
 * `readFixedString(N)` returns the reader.
 *
 * The value is right-padded with NUL bytes to `size`; those trailing `\x00` are
 * part of the stored value and are preserved here. Trim them
 * (`.replace(/\x00+$/, "")`) only if your column holds NUL-terminated text.
 *
 * ClickHouse server returns `FixedString`s in JSON with the trailing NULs,
 * therefore this reader preserves them as well.
 */
export function readFixedString(size: number): Reader<string> {
  return (state) => {
    const start = advance(state, size);
    return state.buf.toString("utf8", start, start + size);
  };
}

/**
 * Read a `FixedString(N)` as raw bytes (no UTF-8 decode) — for binary columns.
 * Curried: `readFixedStringBytes(N)` returns the reader. Returns a zero-copy
 * view: no allocation, but the slice shares memory with the response, so
 * retaining any one slice pins the entire chunk buffer in memory.
 *
 * SAFE TO TOGGLE — if the bytes outlive the row/response, return an independent
 * copy instead so the chunk can be freed:
 *
 *   // return Buffer.from(state.buf.subarray(start, start + size));
 *
 * Make an educated tradeoff: view (default) when consumed immediately, a copy
 * when retained.
 */
export function readFixedStringBytes(size: number): Reader<Buffer> {
  return (state) => {
    const start = advance(state, size);
    return state.buf.subarray(start, start + size);
  };
}

/**
 * Write a `String`: a varint byte-length prefix followed by the UTF-8 bytes.
 * The inverse of {@link readString}.
 *
 * Accepts a `string` (encoded as UTF-8) or a `Buffer`/`Uint8Array` of raw bytes
 * — use the latter for ClickHouse `String` columns holding arbitrary (non-UTF-8)
 * bytes, mirroring the reader's note that `String` is not guaranteed UTF-8.
 */
export function writeString(
  sink: Sink,
  value: string | Uint8Array,
): void {
  if (typeof value === "string") {
    const len = Buffer.byteLength(value, "utf8");
    writeUVarint(sink, len);
    const o = reserve(sink, len);
    sink.buf.write(value, o, len, "utf8");
  } else {
    writeUVarint(sink, value.length);
    const o = reserve(sink, value.length);
    sink.buf.set(value, o);
  }
}

/**
 * Write a `FixedString(N)` from a string: exactly `size` bytes, UTF-8 encoded and
 * right-padded with NUL bytes (`\x00`) to `size`. Curried: `writeFixedString(N)`
 * returns the writer. The inverse of {@link readFixedString} — which preserves
 * the trailing NULs, so re-encoding a value it produced is byte-exact.
 *
 * Throws if the UTF-8 encoding exceeds `size` bytes (it would not fit the column).
 */
export function writeFixedString(size: number): Writer<string> {
  return (sink, value) => {
    const len = Buffer.byteLength(value, "utf8");
    if (len > size) {
      throw new RangeError(
        `RowBinary: FixedString value is ${len} bytes, exceeds FixedString(${size})`,
      );
    }
    const o = reserve(sink, size);
    sink.buf.write(value, o, len, "utf8");
    // reserve() hands back uninitialized memory (allocUnsafe); zero the padding.
    sink.buf.fill(0, o + len, o + size);
  };
}

/**
 * Write a `FixedString(N)` from raw bytes: exactly `size` bytes, the value
 * copied verbatim and right-padded with NUL bytes if shorter. Curried:
 * `writeFixedStringBytes(N)` returns the writer. The inverse of
 * {@link readFixedStringBytes} (binary columns).
 *
 * Throws if the value is longer than `size`.
 */
export function writeFixedStringBytes(size: number): Writer<Uint8Array> {
  return (sink, value) => {
    if (value.length > size) {
      throw new RangeError(
        `RowBinary: FixedString value is ${value.length} bytes, exceeds FixedString(${size})`,
      );
    }
    const o = reserve(sink, size);
    sink.buf.set(value, o);
    sink.buf.fill(0, o + value.length, o + size);
  };
}
