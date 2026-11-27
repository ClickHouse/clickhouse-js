/**
 * The LZ4 block format (https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md),
 * as the LZ4 codec of ClickHouse uses it: one block, no frame header.
 *
 * Real data has many short literals and matches. A `Buffer.copy` call costs
 * more than a loop for a few bytes, so the code copies short runs 8 bytes at a
 * time through a `DataView` (as the reference implementation's "wild copy"
 * does, but only inside the buffers) and long runs with `copy` /
 * `copyWithin` / `fill`.
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
/** Copies of this many bytes or more use `copy` / `copyWithin`; shorter ones
 *  use word or byte loops. */
const LONG_COPY = 64;
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
  const n = decompressedSize;
  const dst = Buffer.allocUnsafe(n);
  // Word views for the 8-byte copies of short runs.
  const sv = new DataView(src.buffer, src.byteOffset, src.length);
  const dv = new DataView(dst.buffer, dst.byteOffset, n);
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
    const literalsEnd = ip + literals;
    if (literalsEnd > end || op + literals > n) {
      throw new Error("Corrupted LZ4 data: literals out of bounds");
    }
    if (literals < LONG_COPY) {
      // Copy whole words: up to 7 bytes more than the literals, when both
      // buffers have them. The next sequence overwrites the extra bytes.
      const words = (literals + 7) & ~7;
      if (ip + words <= end && op + words <= n) {
        for (let i = 0; i < literals; i += 8) {
          dv.setInt32(op + i, sv.getInt32(ip + i, true), true);
          dv.setInt32(op + i + 4, sv.getInt32(ip + i + 4, true), true);
        }
        op += literals;
        ip = literalsEnd;
      } else {
        while (ip < literalsEnd) dst[op++] = src[ip++]!;
      }
    } else {
      src.copy(dst, op, ip, literalsEnd);
      op += literals;
      ip = literalsEnd;
    }
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
    const matchEnd = op + length;
    if (matchEnd > n) {
      throw new Error("Corrupted LZ4 data: match out of bounds");
    }
    let from = op - offset;
    if (length < LONG_COPY) {
      // Whole words when a word does not overlap its own source (offset >= 8)
      // and the output has room for the extra bytes.
      if (offset >= 8 && op + ((length + 7) & ~7) <= n) {
        for (let i = 0; i < length; i += 8) {
          dv.setInt32(op + i, dv.getInt32(from + i, true), true);
          dv.setInt32(op + i + 4, dv.getInt32(from + i + 4, true), true);
        }
        op = matchEnd;
      } else {
        while (op < matchEnd) dst[op++] = dst[from++]!;
      }
    } else if (offset === 1) {
      dst.fill(dst[from]!, op, matchEnd);
      op = matchEnd;
    } else if (offset >= length) {
      dst.copyWithin(op, from, from + length);
      op = matchEnd;
    } else {
      // Overlapping long match: copy one period (`offset` bytes), then double
      // `copied` (always a multiple of `offset`).
      if (offset < LONG_COPY) {
        for (let i = 0; i < offset; i++) dst[op + i] = dst[from + i]!;
      } else {
        dst.copyWithin(op, from, from + offset);
      }
      let copied = offset;
      while (copied < length) {
        const chunk = copied < length - copied ? copied : length - copied;
        dst.copyWithin(op + copied, op, op + chunk);
        copied += chunk;
      }
      op = matchEnd;
    }
  }
  if (op !== n) {
    throw new Error(`Corrupted LZ4 data: ${op} bytes instead of ${n}`);
  }
  return dst;
}

/** Positions + 1 of the last 4-byte sequences, by hash (0 means empty).
 *  One table for all calls: compression is synchronous. A call uses (and
 *  clears) only the first entries when the input is small. */
const table = new Int32Array(1 << HASH_LOG);

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
    // 4-byte little-endian reads of the input.
    const sv = new DataView(src.buffer, src.byteOffset, n);
    const log = hashLog(n);
    const shift = 32 - log;
    table.fill(0, 0, 1 << log);
    const matchLimit = n - LAST_LITERALS;
    const searchLimit = n - MF_LIMIT;
    let ip = 0;
    let misses = 1 << SKIP_TRIGGER;
    while (ip < searchLimit) {
      const seq = sv.getInt32(ip, true);
      const h = hash4(seq, shift);
      const candidate = table[h]! - 1;
      table[h] = ip + 1;
      if (
        candidate < 0 ||
        ip - candidate > MAX_OFFSET ||
        sv.getInt32(candidate, true) !== seq
      ) {
        ip += misses++ >>> SKIP_TRIGGER;
        continue;
      }
      misses = 1 << SKIP_TRIGGER;
      // Extend the match backward over the literals.
      let start = ip;
      let ref = candidate;
      while (start > anchor && ref > 0 && src[start - 1] === src[ref - 1]) {
        start--;
        ref--;
      }
      // Extend it forward 4 bytes at a time: the lowest set bit of the xor
      // gives the first byte that differs.
      let p = ip + MIN_MATCH;
      let q = candidate + MIN_MATCH;
      let mismatch = false;
      while (p + 4 <= matchLimit) {
        const x = sv.getInt32(p, true) ^ sv.getInt32(q, true);
        if (x !== 0) {
          p += (31 - Math.clz32(x & -x)) >>> 3;
          mismatch = true;
          break;
        }
        p += 4;
        q += 4;
      }
      if (!mismatch) {
        while (p < matchLimit && src[p] === src[q]) {
          p++;
          q++;
        }
      }
      // Sequence: token, literals, offset, match length.
      const literals = start - anchor;
      const matchCode = p - start - MIN_MATCH;
      dst[op++] =
        ((literals >= 15 ? 15 : literals) << 4) |
        (matchCode >= 15 ? 15 : matchCode);
      if (literals >= 15) {
        let rest = literals - 15;
        while (rest >= 255) {
          dst[op++] = 255;
          rest -= 255;
        }
        dst[op++] = rest;
      }
      if (literals < LONG_COPY) {
        for (let i = anchor; i < start; i++) dst[op++] = src[i]!;
      } else {
        src.copy(dst, op, anchor, start);
        op += literals;
      }
      const offset = start - ref;
      dst[op++] = offset & 0xff;
      dst[op++] = offset >>> 8;
      if (matchCode >= 15) {
        let rest = matchCode - 15;
        while (rest >= 255) {
          dst[op++] = 255;
          rest -= 255;
        }
        dst[op++] = rest;
      }
      ip = p;
      anchor = ip;
      // Index a position inside the match to find the next match faster.
      if (ip - 2 < searchLimit && ip >= 2) {
        table[hash4(sv.getInt32(ip - 2, true), shift)] = ip - 2 + 1;
      }
    }
  }
  // The last literals.
  const literals = n - anchor;
  dst[op++] = (literals >= 15 ? 15 : literals) << 4;
  if (literals >= 15) {
    let rest = literals - 15;
    while (rest >= 255) {
      dst[op++] = 255;
      rest -= 255;
    }
    dst[op++] = rest;
  }
  src.copy(dst, op, anchor, n);
  return op + literals;
}
