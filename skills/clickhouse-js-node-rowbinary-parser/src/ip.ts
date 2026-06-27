import { Cursor, advance, Sink, reserve } from "./core.js";

/**
 * Read an `IPv4`: stored as a 4-byte little-endian `UInt32`. Returns the raw
 * 32-bit value (the little-endian load already orders the octets); pass it to
 * {@link formatIPv4} for the dotted-quad string.
 */
export function readIPv4(state: Cursor): number {
  return state.view.getUint32(advance(state, 4), true);
}

/**
 * Read an `IPv6`: 16 bytes in network (big-endian) order. Returns the raw bytes
 * as a zero-copy view; pass them to {@link formatIPv6} for the canonical string.
 *
 * The view shares memory with the response buffer, so keeping it alive pins the
 * whole response chunk in memory. If the value must outlive the row/response,
 * copy it with `Buffer.from(...)`.
 */
export function readIPv6(state: Cursor): Buffer {
  const start = advance(state, 16);
  return state.buf.subarray(start, start + 16);
}

/**
 * Format an `IPv4` (the raw 32-bit value from {@link readIPv4}) as a dotted-quad
 * string. Kept aside so the hot read path can skip building a string when the
 * numeric value is all the caller needs.
 */
export function formatIPv4(value: number): string {
  return `${(value >>> 24) & 0xff}.${(value >>> 16) & 0xff}.${(value >>> 8) & 0xff}.${value & 0xff}`;
}

/**
 * Join groups `[from, to)` as colon-separated lowercase hex, by concatenating
 * into a string in a loop. Benchmarks faster than `slice().map().join(":")`,
 * which allocates an intermediate array. Returns `""` for an empty range.
 */
function joinGroupsHex(g: number[], from: number, to: number): string {
  if (from >= to) return "";
  let s = g[from]!.toString(16);
  for (let i = from + 1; i < to; i++) s += ":" + g[i]!.toString(16);
  return s;
}

/**
 * Format an `IPv6` (the raw 16 bytes from {@link readIPv6}) as the canonical
 * RFC 5952 string: lowercase, no leading zeros, the longest run of zero groups
 * (>= 2) collapsed to `::` (leftmost on a tie), and the `::ffff:a.b.c.d` form
 * for IPv4-mapped addresses (matching ClickHouse).
 *
 * Kept aside from the read so the hot path only formats when a string is
 * actually needed.
 */
export function formatIPv6(b: Buffer): string {
  // IPv4-mapped (::ffff:a.b.c.d): first 10 bytes zero, then 0xffff.
  let mapped = b[10] === 0xff && b[11] === 0xff;
  for (let i = 0; mapped && i < 10; i++) {
    if (b[i] !== 0) mapped = false;
  }
  if (mapped) {
    return `::ffff:${b[12]}.${b[13]}.${b[14]}.${b[15]}`;
  }

  // Eight 16-bit groups, big-endian.
  const g: number[] = [];
  for (let i = 0; i < 8; i++) {
    g.push((b[2 * i]! << 8) | b[2 * i + 1]!);
  }

  // Longest run of >= 2 zero groups becomes "::" (leftmost wins on a tie).
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (g[i] === 0) {
      if (curStart < 0) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) {
    return joinGroupsHex(g, 0, 8);
  }
  return `${joinGroupsHex(g, 0, bestStart)}::${joinGroupsHex(g, bestStart + bestLen, 8)}`;
}

/**
 * Write an `IPv4`: the raw 32-bit value (as produced by {@link readIPv4}) as a
 * 4-byte little-endian `UInt32`. The inverse of {@link readIPv4}; pair with
 * {@link parseIPv4} to start from a dotted-quad string.
 */
export function writeIPv4(sink: Sink, value: number): void {
  sink.view.setUint32(reserve(sink, 4), value, true);
}

/**
 * Write an `IPv6`: the raw 16 bytes (network order, as produced by
 * {@link readIPv6}) copied verbatim. The inverse of {@link readIPv6}; pair with
 * {@link parseIPv6} to start from a string. Throws unless exactly 16 bytes.
 */
export function writeIPv6(sink: Sink, value: Uint8Array): void {
  if (value.length !== 16) {
    throw new RangeError(
      `RowBinary: IPv6 must be 16 bytes, got ${value.length}`,
    );
  }
  const o = reserve(sink, 16);
  sink.buf.set(value, o);
}

/**
 * Parse a dotted-quad IPv4 string into the raw 32-bit value — the inverse of
 * {@link formatIPv4}. `"1.2.3.4"` -> `0x01020304`. Pair with {@link writeIPv4}.
 */
export function parseIPv4(text: string): number {
  const parts = text.split(".");
  if (parts.length !== 4) {
    throw new RangeError(`RowBinary: invalid IPv4 string ${JSON.stringify(text)}`);
  }
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet < 0 || octet > 255) {
      throw new RangeError(
        `RowBinary: invalid IPv4 octet ${JSON.stringify(part)}`,
      );
    }
    value = (value << 8) | octet;
  }
  return value >>> 0;
}

/**
 * Parse an IPv6 string into its raw 16 bytes (network order) — the inverse of
 * {@link formatIPv6}, accepting the canonical forms it emits (`::` zero-run
 * compression and the `::ffff:a.b.c.d` IPv4-mapped form) as well as the fully
 * expanded form. Pair with {@link writeIPv6}.
 */
export function parseIPv6(text: string): Buffer {
  const out = Buffer.alloc(16);
  const halves = text.split("::");
  if (halves.length > 2) {
    throw new RangeError(`RowBinary: invalid IPv6 string ${JSON.stringify(text)}`);
  }

  // Expand a colon-separated side into 16-bit groups, splitting a trailing
  // embedded IPv4 (a.b.c.d) into its two groups.
  const toGroups = (side: string): number[] => {
    if (side === "") return [];
    const groups: number[] = [];
    for (const part of side.split(":")) {
      if (part.includes(".")) {
        const v4 = parseIPv4(part);
        groups.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        groups.push(parseInt(part, 16) & 0xffff);
      }
    }
    return groups;
  };

  const head = toGroups(halves[0]!);
  const tail = halves.length === 2 ? toGroups(halves[1]!) : [];
  const groups =
    halves.length === 2
      ? [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail]
      : head;
  if (groups.length !== 8) {
    throw new RangeError(`RowBinary: invalid IPv6 string ${JSON.stringify(text)}`);
  }
  for (let i = 0; i < 8; i++) {
    out[2 * i] = (groups[i]! >>> 8) & 0xff;
    out[2 * i + 1] = groups[i]! & 0xff;
  }
  return out;
}
