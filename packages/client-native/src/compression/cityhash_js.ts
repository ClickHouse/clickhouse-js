/**
 * CityHash128 v1.0.2 in plain JavaScript: the fallback when WebAssembly is
 * not available, and the reference for the tests of the WebAssembly version
 * (see cityhash.ts).
 *
 * JavaScript has no 64-bit integers that are fast. A 64-bit value here is two
 * unsigned 32-bit numbers: `h` (high bits) and `l` (low bits).
 */

/** A 64-bit unsigned value. */
interface W {
  h: number;
  l: number;
}

function w(h: number, l: number): W {
  return { h: h >>> 0, l: l >>> 0 };
}

const K0 = w(0xc3a5c85c, 0x97cb3127);
const K1 = w(0xb492b66f, 0xbe98f273);
const K2 = w(0x9ae16a3b, 0x2f90404f);
const K3 = w(0xc949d7c7, 0x509e6557);
const K_MUL = w(0x9ddfea08, 0xeb382d69);

function add(a: W, b: W): W {
  const l = a.l + b.l;
  return w(a.h + b.h + (l > 0xffffffff ? 1 : 0), l);
}

function sub(a: W, b: W): W {
  const l = a.l - b.l;
  return w(a.h - b.h - (l < 0 ? 1 : 0), l);
}

function xor(a: W, b: W): W {
  return w(a.h ^ b.h, a.l ^ b.l);
}

/** The low 64 bits of a * b. */
function mul(a: W, b: W): W {
  const a0 = a.l & 0xffff;
  const a1 = a.l >>> 16;
  const b0 = b.l & 0xffff;
  const b1 = b.l >>> 16;
  const mid = a0 * b1 + a1 * b0; // < 2^33
  const low = a0 * b0 + (mid % 0x10000) * 0x10000; // < 2^33
  const carry = Math.floor(low / 0x100000000);
  const high =
    a1 * b1 +
    Math.floor(mid / 0x10000) +
    carry +
    Math.imul(a.h, b.l) +
    Math.imul(a.l, b.h);
  return w(high, low);
}

function shr(a: W, s: number): W {
  if (s === 0) return a;
  if (s < 32) return w(a.h >>> s, (a.l >>> s) | (a.h << (32 - s)));
  return w(0, a.h >>> (s - 32));
}

function rotate(a: W, s: number): W {
  if (s === 0) return a;
  if (s === 32) return w(a.l, a.h);
  if (s < 32) {
    return w((a.h >>> s) | (a.l << (32 - s)), (a.l >>> s) | (a.h << (32 - s)));
  }
  const t = s - 32;
  return w((a.l >>> t) | (a.h << (32 - t)), (a.h >>> t) | (a.l << (32 - t)));
}

function shiftMix(a: W): W {
  return xor(a, shr(a, 47));
}

function fromNumber(n: number): W {
  return w(Math.floor(n / 0x100000000), n % 0x100000000);
}

function fetch64(buf: Uint8Array, i: number): W {
  return w(
    buf[i + 4]! |
      (buf[i + 5]! << 8) |
      (buf[i + 6]! << 16) |
      (buf[i + 7]! << 24),
    buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16) | (buf[i + 3]! << 24),
  );
}

function fetch32(buf: Uint8Array, i: number): W {
  return w(
    0,
    buf[i]! | (buf[i + 1]! << 8) | (buf[i + 2]! << 16) | (buf[i + 3]! << 24),
  );
}

function hashLen16(u: W, v: W): W {
  let a = mul(xor(u, v), K_MUL);
  a = xor(a, shr(a, 47));
  let b = mul(xor(v, a), K_MUL);
  b = xor(b, shr(b, 47));
  return mul(b, K_MUL);
}

function hashLen0to16(s: Uint8Array, p: number, len: number): W {
  if (len > 8) {
    const a = fetch64(s, p);
    const b = fetch64(s, p + len - 8);
    // RotateByAtLeast1(b + len, len): len is 9..16
    return xor(hashLen16(a, rotate(add(b, fromNumber(len)), len)), b);
  }
  if (len >= 4) {
    const a = fetch32(s, p);
    return hashLen16(add(fromNumber(len), shl3(a)), fetch32(s, p + len - 4));
  }
  if (len > 0) {
    const a = s[p]!;
    const b = s[p + (len >> 1)]!;
    const c = s[p + len - 1]!;
    const y = (a + (b << 8)) >>> 0;
    const z = (len + (c << 2)) >>> 0;
    return mul(shiftMix(xor(mul(w(0, y), K2), mul(w(0, z), K3))), K2);
  }
  return K2;
}

/** a << 3 for a value below 2^32. */
function shl3(a: W): W {
  return w(a.l >>> 29, a.l << 3);
}

function weakHashLen32WithSeeds(s: Uint8Array, p: number, a: W, b: W): [W, W] {
  const x0 = fetch64(s, p);
  const x1 = fetch64(s, p + 8);
  const x2 = fetch64(s, p + 16);
  const x3 = fetch64(s, p + 24);
  a = add(a, x0);
  b = rotate(add(add(b, a), x3), 21);
  const c = a;
  a = add(a, x1);
  a = add(a, x2);
  b = add(b, rotate(a, 44));
  return [add(a, x3), add(b, c)];
}

function cityMurmur(
  s: Uint8Array,
  p: number,
  len: number,
  seedLow: W,
  seedHigh: W,
): [W, W] {
  let a = seedLow;
  let b = seedHigh;
  let c: W;
  let d: W;
  let l = len - 16;
  if (l <= 0) {
    a = mul(shiftMix(mul(a, K1)), K1);
    c = add(mul(b, K1), hashLen0to16(s, p, len));
    d = shiftMix(add(a, len >= 8 ? fetch64(s, p) : c));
  } else {
    c = hashLen16(add(fetch64(s, p + len - 8), K1), a);
    d = hashLen16(add(b, fromNumber(len)), add(c, fetch64(s, p + len - 16)));
    a = add(a, d);
    do {
      a = xor(a, mul(shiftMix(mul(fetch64(s, p), K1)), K1));
      a = mul(a, K1);
      b = xor(b, a);
      c = xor(c, mul(shiftMix(mul(fetch64(s, p + 8), K1)), K1));
      c = mul(c, K1);
      d = xor(d, c);
      p += 16;
      l -= 16;
    } while (l > 0);
  }
  a = hashLen16(a, c);
  b = hashLen16(d, b);
  return [xor(a, b), hashLen16(b, a)];
}

function cityHash128WithSeed(
  s: Uint8Array,
  p: number,
  len: number,
  seedLow: W,
  seedHigh: W,
): [W, W] {
  if (len < 128) return cityMurmur(s, p, len, seedLow, seedHigh);
  let x = seedLow;
  let y = seedHigh;
  let z = mul(fromNumber(len), K1);
  let v0 = add(mul(rotate(xor(y, K1), 49), K1), fetch64(s, p));
  let v1 = add(mul(rotate(v0, 42), K1), fetch64(s, p + 8));
  let w0 = add(mul(rotate(add(y, z), 35), K1), x);
  let w1 = mul(rotate(add(x, fetch64(s, p + 88)), 53), K1);
  let t: W;
  do {
    for (let round = 0; round < 2; round++) {
      x = mul(rotate(add(add(add(x, y), v0), fetch64(s, p + 16)), 37), K1);
      y = mul(rotate(add(add(y, v1), fetch64(s, p + 48)), 42), K1);
      x = xor(x, w1);
      y = xor(y, v0);
      z = rotate(xor(z, w0), 33);
      [v0, v1] = weakHashLen32WithSeeds(s, p, mul(v1, K1), add(x, w0));
      [w0, w1] = weakHashLen32WithSeeds(s, p + 32, add(z, w1), y);
      t = z;
      z = x;
      x = t;
      p += 64;
    }
    len -= 128;
  } while (len >= 128);
  y = add(y, add(mul(rotate(w0, 37), K0), z));
  x = add(x, mul(rotate(add(v0, z), 49), K0));
  for (let tailDone = 0; tailDone < len;) {
    tailDone += 32;
    y = add(mul(rotate(sub(y, x), 42), K0), v1);
    w0 = add(w0, fetch64(s, p + len - tailDone + 16));
    x = add(mul(rotate(x, 49), K0), w0);
    w0 = add(w0, v0);
    [v0, v1] = weakHashLen32WithSeeds(s, p + len - tailDone, v0, v1);
  }
  x = hashLen16(x, v0);
  y = hashLen16(y, w0);
  return [add(hashLen16(add(x, v1), w1), y), hashLen16(add(x, w1), add(y, v1))];
}

/** CityHash128 v1.0.2 as 16 bytes: the low 64 bits, then the high 64 bits,
 *  both little-endian (the layout of the checksum in a compressed block). */
export function cityHash128JS(data: Uint8Array): Buffer {
  const len = data.length;
  let low: W;
  let high: W;
  if (len >= 16) {
    [low, high] = cityHash128WithSeed(
      data,
      16,
      len - 16,
      xor(fetch64(data, 0), K3),
      fetch64(data, 8),
    );
  } else if (len >= 8) {
    [low, high] = cityHash128WithSeed(
      data,
      0,
      0,
      xor(fetch64(data, 0), mul(fromNumber(len), K0)),
      xor(fetch64(data, len - 8), K1),
    );
  } else {
    [low, high] = cityHash128WithSeed(data, 0, len, K0, K1);
  }
  const out = Buffer.allocUnsafe(16);
  out.writeUInt32LE(low.l, 0);
  out.writeUInt32LE(low.h, 4);
  out.writeUInt32LE(high.l, 8);
  out.writeUInt32LE(high.h, 12);
  return out;
}
