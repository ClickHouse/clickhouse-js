import { Sink, reserve } from "./core_writer.js";

/**
 * Write an `IPv4`: the raw 32-bit value (as produced by `readIPv4`) as a 4-byte
 * little-endian `UInt32`. The inverse of `readIPv4`; pair with {@link parseIPv4}
 * to start from a dotted-quad string.
 */
export function writeIPv4(sink: Sink, value: number): void {
  sink.view.setUint32(reserve(sink, 4), value, true);
}

/**
 * Write an `IPv6`: the raw 16 bytes (network order, as produced by `readIPv6`)
 * copied verbatim. The inverse of `readIPv6`; pair with {@link parseIPv6} to
 * start from a string. Throws unless exactly 16 bytes.
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
 * `formatIPv4`. `"1.2.3.4"` -> `0x01020304`. Pair with {@link writeIPv4}.
 */
export function parseIPv4(text: string): number {
  const parts = text.split(".");
  if (parts.length !== 4) {
    throw new RangeError(
      `RowBinary: invalid IPv4 string ${JSON.stringify(text)}`,
    );
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
 * `formatIPv6`, accepting the canonical forms it emits (`::` zero-run compression
 * and the `::ffff:a.b.c.d` IPv4-mapped form) as well as the fully expanded form.
 * Pair with {@link writeIPv6}.
 */
export function parseIPv6(text: string): Buffer {
  const out = Buffer.alloc(16);
  const halves = text.split("::");
  if (halves.length > 2) {
    throw new RangeError(
      `RowBinary: invalid IPv6 string ${JSON.stringify(text)}`,
    );
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
    throw new RangeError(
      `RowBinary: invalid IPv6 string ${JSON.stringify(text)}`,
    );
  }
  for (let i = 0; i < 8; i++) {
    out[2 * i] = (groups[i]! >>> 8) & 0xff;
    out[2 * i + 1] = groups[i]! & 0xff;
  }
  return out;
}
