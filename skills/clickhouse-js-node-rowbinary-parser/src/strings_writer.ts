import { type Writer, Sink, reserve } from "./core_writer.js";
import { writeUVarint } from "./varint_writer.js";

/**
 * Write a `String`: a varint byte-length prefix followed by the UTF-8 bytes. The
 * inverse of `readString`.
 *
 * Accepts a `string` (encoded as UTF-8) or a `Buffer`/`Uint8Array` of raw bytes —
 * use the latter for ClickHouse `String` columns holding arbitrary (non-UTF-8)
 * bytes, mirroring the reader's note that `String` is not guaranteed UTF-8.
 */
export function writeString(sink: Sink, value: string | Uint8Array): void {
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
 * returns the writer. The inverse of `readFixedString` — which preserves the
 * trailing NULs, so re-encoding a value it produced is byte-exact.
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
    // The sink's buffer may be uninitialized (allocUnsafe); zero the padding.
    sink.buf.fill(0, o + len, o + size);
  };
}

/**
 * Write a `FixedString(N)` from raw bytes: exactly `size` bytes, the value copied
 * verbatim and right-padded with NUL bytes if shorter. Curried:
 * `writeFixedStringBytes(N)` returns the writer. The inverse of
 * `readFixedStringBytes` (binary columns).
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
