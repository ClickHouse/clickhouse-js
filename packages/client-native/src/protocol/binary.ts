import { constants } from "node:buffer";

/** Upper bound for a single wire byte sequence (1 GiB, matching ClickHouse's
 *  `DBMS_MAX_COMPRESSED_SIZE`) so corrupted lengths fail fast with
 *  {@link ProtocolError} instead of waiting until `request_timeout`. */
export const MAX_BYTES_LENGTH = 0x40000000;

/**
 * Thrown by {@link BinaryReader} when the buffer does not contain enough
 * bytes. The packet reader catches it, waits for more data from the socket
 * and parses the packet again from its start.
 */
export class NeedMoreData extends Error {
  /** The buffer length that the failed read needed (a lower bound for the
   *  length of the packet). */
  needed = 0;
  /** True when the read is sure to succeed with `needed` bytes and completes
   *  a large unit of work (a compressed block). The socket then parses again
   *  as soon as it has `needed` bytes. */
  firm = false;
  /** Offset in the current buffer up to which bytes were already consumed
   *  (for example, completed compressed frames of a multi-frame packet). */
  consumed = 0;
  constructor() {
    super("Need more data");
    Object.setPrototypeOf(this, NeedMoreData.prototype);
  }
}

/**
 * Reused singleton thrown by {@link BinaryReader.ensure} to avoid allocating a
 * stack trace on every fragmented TCP chunk.
 *
 * Invariant: this instance is mutated synchronously by `ensure()` and MUST be
 * caught synchronously on the same call stack (never persisted, rethrown across
 * `await`, or allowed to escape uncaught, as its stack trace reflects module
 * load rather than the failing read).
 */
const NEED_MORE_DATA = new NeedMoreData();

/** Thrown when the data from the server is not correct. The connection
 *  cannot be used after this error. */
export class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}

/** Reads little-endian binary values, as the ClickHouse protocol writes them. */
export class BinaryReader {
  buf: Buffer;
  pos: number;

  constructor(buf: Buffer, pos = 0) {
    this.buf = buf;
    this.pos = pos;
  }

  ensure(n: number): void {
    if (this.pos + n > this.buf.length) {
      NEED_MORE_DATA.needed = this.pos + n;
      NEED_MORE_DATA.firm = false;
      NEED_MORE_DATA.consumed = 0;
      throw NEED_MORE_DATA;
    }
  }

  u8(): number {
    this.ensure(1);
    return this.buf[this.pos++] as number;
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  i32(): number {
    this.ensure(4);
    const v = this.buf.readInt32LE(this.pos);
    this.pos += 4;
    return v;
  }

  u64(): bigint {
    this.ensure(8);
    const v = this.buf.readBigUInt64LE(this.pos);
    this.pos += 8;
    return v;
  }

  /** Reads a UInt64 that must fit a safe JS integer (counts, sizes, offsets). */
  u64n(): number {
    this.ensure(8);
    const lo = this.buf.readUInt32LE(this.pos);
    const hi = this.buf.readUInt32LE(this.pos + 4);
    this.pos += 8;
    if (hi > 0x1fffff) {
      throw new ProtocolError("A UInt64 value is too large for a size");
    }
    return hi * 0x100000000 + lo;
  }

  /** Reads an unsigned LEB128 value that fits in a safe JS integer. */
  varuint(): number {
    let result = 0;
    let multiplier = 1;
    for (let i = 0; i < 10; i++) {
      this.ensure(1);
      const byte = this.buf[this.pos++] as number;
      result += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (result > Number.MAX_SAFE_INTEGER) {
          throw new ProtocolError("A VarUInt value is too large");
        }
        return result;
      }
      multiplier *= 128;
    }
    throw new ProtocolError("A VarUInt value is longer than 10 bytes");
  }

  /** Reads an unsigned 64-bit LEB128 value as a bigint. */
  varuint64(): bigint {
    let result = 0n;
    let shift = 0n;
    for (let i = 0; i < 10; i++) {
      this.ensure(1);
      const byte = this.buf[this.pos++] as number;
      if (i === 9 && byte > 1) {
        throw new ProtocolError("A VarUInt value overflows UInt64");
      }
      result |= BigInt(byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) {
        return result;
      }
      shift += 7n;
    }
    throw new ProtocolError("A VarUInt value is longer than 10 bytes");
  }

  /** Reads a VarUInt length and that many bytes. */
  bytes(): Buffer {
    const len = this.varuint();
    if (len > MAX_BYTES_LENGTH) {
      throw new ProtocolError(
        `Byte sequence length ${len} exceeds maximum allowed size`,
      );
    }
    return this.fixed(len);
  }

  string(): string {
    const len = this.varuint();
    if (len > constants.MAX_STRING_LENGTH) {
      throw new ProtocolError(
        `String length ${len} exceeds maximum allowed size`,
      );
    }
    this.ensure(len);
    const s = this.buf.toString("utf8", this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  fixed(n: number): Buffer {
    this.ensure(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  skip(n: number): void {
    this.ensure(n);
    this.pos += n;
  }
}

/**
 * Collects binary values of an outgoing packet or Native column.
 *
 * Small scalar writes grow exponentially up to 64 KiB chunks; large pre-built
 * buffers are attached without copying via {@link append}. Call {@link buffers}
 * for zero-copy chunk access or {@link toBuffer} for a single contiguous buffer.
 */
export class BinaryWriter {
  private chunks: Buffer[] = [];
  private chunkSize = 256;
  private current: Buffer = Buffer.allocUnsafe(this.chunkSize);
  private offset = 0;

  private reserve(n: number): void {
    if (this.offset + n <= this.current.length) return;
    this.flush();
    this.chunkSize = Math.min(this.chunkSize * 2, 65536);
    this.current = Buffer.allocUnsafe(Math.max(n, this.chunkSize));
  }

  private flush(): void {
    if (this.offset > 0) {
      this.chunks.push(this.current.subarray(0, this.offset));
      this.current = this.current.subarray(this.offset);
      this.offset = 0;
    }
  }

  u8(v: number): this {
    this.reserve(1);
    this.current[this.offset++] = v;
    return this;
  }

  u64(v: bigint | number): this {
    this.reserve(8);
    if (typeof v === "number") {
      this.current.writeUInt32LE(v >>> 0, this.offset);
      this.current.writeUInt32LE(Math.floor(v / 0x100000000), this.offset + 4);
    } else {
      this.current.writeBigUInt64LE(v, this.offset);
    }
    this.offset += 8;
    return this;
  }

  i64(v: bigint | number): this {
    this.reserve(8);
    this.current.writeBigInt64LE(BigInt(v), this.offset);
    this.offset += 8;
    return this;
  }

  varuint(v: number): this {
    this.reserve(10);
    let value = v;
    while (value >= 0x80) {
      this.current[this.offset++] = (value % 0x80) | 0x80;
      value = Math.floor(value / 0x80);
    }
    this.current[this.offset++] = value;
    return this;
  }

  u16(v: number): this {
    this.reserve(2);
    this.current.writeUInt16LE(v, this.offset);
    this.offset += 2;
    return this;
  }

  u32(v: number): this {
    this.reserve(4);
    this.current.writeUInt32LE(v, this.offset);
    this.offset += 4;
    return this;
  }

  /** Writes raw bytes (no length). */
  raw(v: Uint8Array): this {
    this.reserve(v.length);
    this.current.set(v, this.offset);
    this.offset += v.length;
    return this;
  }

  /** Appends an existing buffer without copying. The caller must not mutate it. */
  append(v: Buffer): this {
    if (v.length === 0) return this;
    this.flush();
    this.chunks.push(v);
    return this;
  }

  /** Writes a fixed-size value with a callback on the buffer. */
  fixedWith(size: number, write: (buf: Buffer, offset: number) => void): this {
    this.reserve(size);
    write(this.current, this.offset);
    this.offset += size;
    return this;
  }

  /** The number of bytes written so far. */
  get length(): number {
    let n = this.offset;
    for (const chunk of this.chunks) n += chunk.length;
    return n;
  }

  string(v: string): this {
    const length = Buffer.byteLength(v, "utf8");
    if (length < 0x80) {
      this.reserve(1 + length);
      this.current[this.offset++] = length;
    } else {
      this.varuint(length);
      this.reserve(length);
    }
    this.current.write(v, this.offset, length, "utf8");
    this.offset += length;
    return this;
  }

  bytes(v: Buffer): this {
    this.varuint(v.length);
    this.reserve(v.length);
    v.copy(this.current, this.offset);
    this.offset += v.length;
    return this;
  }

  /** The collected buffers, in order. */
  buffers(): Buffer[] {
    this.flush();
    return this.chunks;
  }

  toBuffer(): Buffer {
    const last = this.current.subarray(0, this.offset);
    return this.chunks.length === 0
      ? Buffer.from(last)
      : Buffer.concat([...this.chunks, last]);
  }
}
