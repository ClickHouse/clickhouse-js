/**
 * The LZ4 block format (https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md),
 * as the LZ4 codec of ClickHouse uses it: one block, no frame header.
 *
 * Real data has many short literals and matches. A `Buffer.copy` call costs
 * more than a byte loop for a few bytes, so the code copies short runs with
 * loops and long runs with `copyWithin` / `set`.
 */

const MIN_MATCH = 4;
/** The last 5 bytes of a block are always literals. */
const LAST_LITERALS = 5;
/** The last match must start at least 12 bytes before the end of the block. */
const MF_LIMIT = 12;
const MAX_OFFSET = 65535;
/** The hash table has 2^HASH_LOG entries for a large input. */
const HASH_LOG = 16;
/** The smallest hash table: 2^MIN_HASH_LOG entries. */
const MIN_HASH_LOG = 8;
/** One byte of compressed data gives 255 bytes at most (a length byte of a
 *  match). */
const MAX_EXPANSION = 255;
const TRUNCATED = "Corrupted LZ4 data: the data ends in a sequence";
/** Copies shorter than this use a byte loop. */
const SHORT_COPY = 32;
/** After 2^SKIP_TRIGGER positions without a match, the search step grows
 *  (the "acceleration" of LZ4): incompressible data is not searched byte by byte. */
const SKIP_TRIGGER = 6;

/** The largest compressed size for `n` input bytes (LZ4_COMPRESSBOUND). */
export function lz4CompressBound(n: number): number {
  return n + Math.floor(n / 255) + 16;
}

export function lz4Decompress(src: Buffer, decompressedSize: number): Buffer {
  // One byte of LZ4 data gives 255 bytes at most. Check this before the
  // allocation: the size comes from the server.
  if (decompressedSize > src.length * MAX_EXPANSION) {
    throw new Error(
      `Corrupted LZ4 data: ${src.length} bytes cannot give ${decompressedSize} bytes`,
    );
  }
  const dst = Buffer.allocUnsafe(decompressedSize);
  let ip = 0;
  let op = 0;
  const end = src.length;
  while (ip < end) {
    const token = src[ip++]!;
    let literals = token >>> 4;
    if (literals === 15) {
      let b: number;
      do {
        if (ip >= end) throw new Error(TRUNCATED);
        b = src[ip++]!;
        literals += b;
      } while (b === 255);
    }
    if (ip + literals > end || op + literals > decompressedSize) {
      throw new Error("Corrupted LZ4 data: literals out of bounds");
    }
    if (literals < SHORT_COPY) {
      for (let i = 0; i < literals; i++) dst[op + i] = src[ip + i]!;
    } else {
      src.copy(dst, op, ip, ip + literals);
    }
    ip += literals;
    op += literals;
    if (ip === end) break; // the last sequence has only literals
    if (ip + 2 > end) throw new Error(TRUNCATED);
    const offset = src[ip]! | (src[ip + 1]! << 8);
    ip += 2;
    if (offset === 0 || offset > op) {
      throw new Error("Corrupted LZ4 data: wrong match offset");
    }
    let length = token & 15;
    if (length === 15) {
      let b: number;
      do {
        if (ip >= end) throw new Error(TRUNCATED);
        b = src[ip++]!;
        length += b;
      } while (b === 255);
    }
    length += MIN_MATCH;
    if (op + length > decompressedSize) {
      throw new Error("Corrupted LZ4 data: match out of bounds");
    }
    const from = op - offset;
    if (offset === 1 && length >= 16) {
      dst.fill(dst[from]!, op, op + length);
    } else if (length < SHORT_COPY || offset < length) {
      // A short match, or a match that overlaps the output: copy bytes in order.
      for (let i = 0; i < length; i++) dst[op + i] = dst[from + i]!;
    } else {
      dst.copyWithin(op, from, from + length);
    }
    op += length;
  }
  if (op !== decompressedSize) {
    throw new Error(
      `Corrupted LZ4 data: ${op} bytes instead of ${decompressedSize}`,
    );
  }
  return dst;
}

/** Positions + 1 of the last 4-byte sequences, by hash (0 means empty).
 *  One table for all calls: compression is synchronous. A call uses (and
 *  clears) only the first entries when the input is small. */
const table = new Int32Array(1 << HASH_LOG);

function read32(b: Uint8Array, i: number): number {
  return b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24);
}

/** The hash of a 4-byte sequence. The table has 2^(32 - shift) entries. */
function hash4(v: number, shift: number): number {
  return Math.imul(v, 2654435761) >>> shift;
}

/** The size of the hash table for `n` input bytes, as a power of two: about
 *  one entry for each input position, 2^HASH_LOG entries at most. */
function hashLog(n: number): number {
  let log = MIN_HASH_LOG;
  while (log < HASH_LOG && 1 << log < n) log++;
  return log;
}

function writeLength(dst: Buffer, op: number, length: number): number {
  while (length >= 255) {
    dst[op++] = 255;
    length -= 255;
  }
  dst[op++] = length;
  return op;
}

function copyBytes(
  dst: Buffer,
  op: number,
  src: Buffer,
  from: number,
  to: number,
): void {
  const n = to - from;
  if (n < SHORT_COPY) {
    for (let i = 0; i < n; i++) dst[op + i] = src[from + i]!;
  } else {
    src.copy(dst, op, from, to);
  }
}

/** Greedy LZ4 compression with a hash table of 4-byte sequences. */
export function lz4Compress(src: Buffer): Buffer {
  const dst = Buffer.allocUnsafe(lz4CompressBound(src.length));
  return dst.subarray(0, lz4CompressInto(src, dst, 0));
}

/**
 * Compresses `src` into `dst` from the offset `op`, and returns the offset
 * after the compressed data. `dst` must have `lz4CompressBound(src.length)`
 * bytes after the offset.
 */
export function lz4CompressInto(src: Buffer, dst: Buffer, op: number): number {
  const n = src.length;
  let anchor = 0;
  if (n >= MF_LIMIT + 1) {
    const log = hashLog(n);
    const shift = 32 - log;
    table.fill(0, 0, 1 << log);
    const matchLimit = n - LAST_LITERALS;
    const searchLimit = n - MF_LIMIT;
    let ip = 0;
    let misses = 1 << SKIP_TRIGGER;
    while (ip < searchLimit) {
      const seq = read32(src, ip);
      const h = hash4(seq, shift);
      const candidate = table[h]! - 1;
      table[h] = ip + 1;
      if (
        candidate < 0 ||
        ip - candidate > MAX_OFFSET ||
        read32(src, candidate) !== seq
      ) {
        ip += misses++ >>> SKIP_TRIGGER;
        continue;
      }
      misses = 1 << SKIP_TRIGGER;
      // Extend the match backward over the literals, then forward.
      let start = ip;
      let ref = candidate;
      while (start > anchor && ref > 0 && src[start - 1] === src[ref - 1]) {
        start--;
        ref--;
      }
      let length = ip - start + MIN_MATCH;
      while (
        start + length < matchLimit &&
        src[start + length] === src[ref + length]
      ) {
        length++;
      }
      // Sequence: token, literals, offset, match length.
      const literals = start - anchor;
      const matchCode = length - MIN_MATCH;
      const tokenPos = op++;
      dst[tokenPos] =
        ((literals >= 15 ? 15 : literals) << 4) |
        (matchCode >= 15 ? 15 : matchCode);
      if (literals >= 15) op = writeLength(dst, op, literals - 15);
      copyBytes(dst, op, src, anchor, start);
      op += literals;
      const offset = start - ref;
      dst[op++] = offset & 0xff;
      dst[op++] = offset >>> 8;
      if (matchCode >= 15) op = writeLength(dst, op, matchCode - 15);
      ip = start + length;
      anchor = ip;
      // Index a position inside the match to find the next match faster.
      if (ip - 2 < searchLimit && ip >= 2) {
        table[hash4(read32(src, ip - 2), shift)] = ip - 2 + 1;
      }
    }
  }
  // The last literals.
  const literals = n - anchor;
  dst[op++] = (literals >= 15 ? 15 : literals) << 4;
  if (literals >= 15) op = writeLength(dst, op, literals - 15);
  copyBytes(dst, op, src, anchor, n);
  return op + literals;
}
