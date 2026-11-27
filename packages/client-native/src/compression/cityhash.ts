import { cityHash128JS } from "./cityhash_js";

/**
 * CityHash128 version 1.0.2: the checksum of the compressed blocks of the
 * native protocol (a port of `contrib/cityhash102` of ClickHouse).
 *
 * The hash needs 64-bit multiplications and rotations. JavaScript can only
 * emulate them with 32-bit numbers, which is slow (about 100 MB/s). This
 * file builds a small WebAssembly module, which has native 64-bit integers,
 * from the bytecode below. The functions follow the C++ code line by line.
 * Without WebAssembly (for example with `--jitless`), the client uses the
 * JavaScript version in cityhash_js.ts. The tests compare the two.
 */

// ---------------------------------------------------------------------------
// A minimal WebAssembly encoder: only what the hash needs.
// ---------------------------------------------------------------------------

type Code = number[];

const I32 = 0x7f;
const I64 = 0x7e;
const VOID = 0x40;

function uleb(n: number): Code {
  const out: Code = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n !== 0) byte |= 0x80;
    out.push(byte);
  } while (n !== 0);
  return out;
}

function sleb(v: bigint): Code {
  const out: Code = [];
  for (;;) {
    const byte = Number(v & 0x7fn);
    v >>= 7n;
    const signBit = (byte & 0x40) !== 0;
    if ((v === 0n && !signBit) || (v === -1n && signBit)) {
      out.push(byte);
      return out;
    }
    out.push(byte | 0x80);
  }
}

const get = (i: number): Code => [0x20, ...uleb(i)];
const set = (i: number, e: Code): Code => [...e, 0x21, ...uleb(i)];
const gget = (i: number): Code => [0x23, ...uleb(i)];
const gset = (i: number, e: Code): Code => [...e, 0x24, ...uleb(i)];
const k = (v: bigint): Code => [0x42, ...sleb(BigInt.asIntN(64, v))];
const i32 = (v: number): Code => [0x41, ...sleb(BigInt(v))];
const call = (f: number, ...args: Code[]): Code => [
  ...args.flat(),
  0x10,
  ...uleb(f),
];
const op =
  (code: number) =>
  (a: Code, b: Code): Code => [...a, ...b, code];
const add = op(0x7c);
const sub = op(0x7d);
const mul = op(0x7e);
const xor = op(0x85);
const shl = op(0x86);
const shr = op(0x88);
const rotr = op(0x8a);
const add32 = op(0x6a);
const sub32 = op(0x6b);
const shr32 = op(0x76);
const gt32 = op(0x4a); // signed
const ge32 = op(0x4e); // signed
const le32 = op(0x4c); // signed
const lt32 = op(0x48); // signed
const ext = (e: Code): Code => [...e, 0xad]; // i64.extend_i32_u
const load64 = (addr: Code): Code => [...addr, 0x29, 0, 0];
const load32 = (addr: Code): Code => [...addr, 0x35, 0, 0]; // i64.load32_u
const load8 = (addr: Code): Code => [...addr, 0x31, 0, 0]; // i64.load8_u
const store64 = (addr: Code, v: Code): Code => [...addr, ...v, 0x37, 0, 0];
const n = (v: number): Code => k(BigInt(v));
const ifThen = (cond: Code, body: Code): Code => [
  ...cond,
  0x04,
  VOID,
  ...body,
  0x0b,
];
const ifElse = (cond: Code, a: Code, b: Code): Code => [
  ...cond,
  0x04,
  I64,
  ...a,
  0x05,
  ...b,
  0x0b,
];
const RETURN = [0x0f];
/** do { body } while (cond) */
const doWhile = (body: Code, cond: Code): Code => [
  0x03,
  VOID,
  ...body,
  ...cond,
  0x0d,
  0,
  0x0b,
];

// ---------------------------------------------------------------------------
// The hash
// ---------------------------------------------------------------------------

const K0 = 0xc3a5c85c97cb3127n;
const K1 = 0xb492b66fbe98f273n;
const K2 = 0x9ae16a3b2f90404fn;
const K3 = 0xc949d7c7509e6557n;
const K_MUL = 0x9ddfea08eb382d69n;

// Function indices
const HASH_LEN_16 = 0;
const HASH_LEN_0_TO_16 = 1;
const WEAK = 2;
const CITY_MURMUR = 3;
const WITH_SEED = 4;
// Globals: the two results of WEAK, CITY_MURMUR and WITH_SEED.
const G0 = 0;
const G1 = 1;

const shiftMix = (local: number): Code =>
  xor(get(local), shr(get(local), n(47)));

interface Func {
  params: number[];
  results: number[];
  locals: number[];
  body: Code;
}

const functions: Func[] = [];

// HashLen16(u, v) = Hash128to64(uint128(u, v))
{
  const [u, v, a, b] = [0, 1, 2, 3];
  functions[HASH_LEN_16] = {
    params: [I64, I64],
    results: [I64],
    locals: [I64, I64],
    body: [
      ...set(a, mul(xor(get(u), get(v)), k(K_MUL))),
      ...set(a, shiftMix(a)),
      ...set(b, mul(xor(get(v), get(a)), k(K_MUL))),
      ...set(b, shiftMix(b)),
      ...mul(get(b), k(K_MUL)),
    ],
  };
}

// HashLen0to16(s, len)
{
  const [s, len, a, b, t] = [0, 1, 2, 3, 4];
  const lenL = ext(get(len));
  functions[HASH_LEN_0_TO_16] = {
    params: [I32, I32],
    results: [I64],
    locals: [I64, I64, I64],
    body: [
      ...ifThen(gt32(get(len), i32(8)), [
        ...set(a, load64(get(s))),
        ...set(b, load64(sub32(add32(get(s), get(len)), i32(8)))),
        ...xor(
          call(HASH_LEN_16, get(a), rotr(add(get(b), lenL), lenL)),
          get(b),
        ),
        ...RETURN,
      ]),
      ...ifThen(ge32(get(len), i32(4)), [
        ...set(a, load32(get(s))),
        ...call(
          HASH_LEN_16,
          add(lenL, shl(get(a), n(3))),
          load32(sub32(add32(get(s), get(len)), i32(4))),
        ),
        ...RETURN,
      ]),
      ...ifThen(gt32(get(len), i32(0)), [
        // y = a + (b << 8); z = len + (c << 2)
        ...set(
          a,
          add(
            load8(get(s)),
            shl(load8(add32(get(s), shr32(get(len), i32(1)))), n(8)),
          ),
        ),
        ...set(
          b,
          add(lenL, shl(load8(sub32(add32(get(s), get(len)), i32(1))), n(2))),
        ),
        ...set(t, xor(mul(get(a), k(K2)), mul(get(b), k(K3)))),
        ...mul(shiftMix(t), k(K2)),
        ...RETURN,
      ]),
      ...k(K2),
    ],
  };
}

// WeakHashLen32WithSeeds(s, a, b) -> (G0, G1)
{
  const [s, a, b, w, x, y, z, c] = [0, 1, 2, 3, 4, 5, 6, 7];
  functions[WEAK] = {
    params: [I32, I64, I64],
    results: [],
    locals: [I64, I64, I64, I64, I64],
    body: [
      ...set(w, load64(get(s))),
      ...set(x, load64(add32(get(s), i32(8)))),
      ...set(y, load64(add32(get(s), i32(16)))),
      ...set(z, load64(add32(get(s), i32(24)))),
      ...set(a, add(get(a), get(w))),
      ...set(b, rotr(add(add(get(b), get(a)), get(z)), n(21))),
      ...set(c, get(a)),
      ...set(a, add(add(get(a), get(x)), get(y))),
      ...set(b, add(get(b), rotr(get(a), n(44)))),
      ...gset(G0, add(get(a), get(z))),
      ...gset(G1, add(get(b), get(c))),
    ],
  };
}

// CityMurmur(s, len, seed = (a, b)) -> (G0 = low, G1 = high)
{
  const [s, len, a, b, c, d, l, t] = [0, 1, 2, 3, 4, 5, 6, 7];
  const mixK1 = (e: Code): Code => [
    ...set(t, mul(e, k(K1))),
    ...mul(shiftMix(t), k(K1)),
  ];
  functions[CITY_MURMUR] = {
    params: [I32, I32, I64, I64],
    results: [],
    locals: [I64, I64, I32, I64],
    body: [
      ...set(l, sub32(get(len), i32(16))),
      ...le32(get(l), i32(0)),
      0x04,
      VOID,
      // len <= 16
      ...set(a, mixK1(get(a))),
      ...set(
        c,
        add(mul(get(b), k(K1)), call(HASH_LEN_0_TO_16, get(s), get(len))),
      ),
      ...set(
        t,
        add(get(a), ifElse(ge32(get(len), i32(8)), load64(get(s)), get(c))),
      ),
      ...set(d, shiftMix(t)),
      0x05,
      // len > 16
      ...set(
        c,
        call(
          HASH_LEN_16,
          add(load64(sub32(add32(get(s), get(len)), i32(8))), k(K1)),
          get(a),
        ),
      ),
      ...set(
        d,
        call(
          HASH_LEN_16,
          add(get(b), ext(get(len))),
          add(get(c), load64(sub32(add32(get(s), get(len)), i32(16)))),
        ),
      ),
      ...set(a, add(get(a), get(d))),
      ...doWhile(
        [
          ...set(a, xor(get(a), mixK1(load64(get(s))))),
          ...set(a, mul(get(a), k(K1))),
          ...set(b, xor(get(b), get(a))),
          ...set(c, xor(get(c), mixK1(load64(add32(get(s), i32(8)))))),
          ...set(c, mul(get(c), k(K1))),
          ...set(d, xor(get(d), get(c))),
          ...set(s, add32(get(s), i32(16))),
          ...set(l, sub32(get(l), i32(16))),
        ],
        gt32(get(l), i32(0)),
      ),
      0x0b,
      ...set(a, call(HASH_LEN_16, get(a), get(c))),
      ...set(b, call(HASH_LEN_16, get(d), get(b))),
      ...gset(G0, xor(get(a), get(b))),
      ...gset(G1, call(HASH_LEN_16, get(b), get(a))),
    ],
  };
}

// CityHash128WithSeed(s, len, seed = (x, y)) -> (G0 = low, G1 = high)
{
  const [s, len, x, y, z, v0, v1, w0, w1, t, tail] = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
  ];
  const at = (offset: number): Code => load64(add32(get(s), i32(offset)));
  const half: Code = [
    // x = Rotate(x + y + v0 + Fetch64(s + 16), 37) * k1
    ...set(
      x,
      mul(rotr(add(add(add(get(x), get(y)), get(v0)), at(16)), n(37)), k(K1)),
    ),
    // y = Rotate(y + v1 + Fetch64(s + 48), 42) * k1
    ...set(y, mul(rotr(add(add(get(y), get(v1)), at(48)), n(42)), k(K1))),
    ...set(x, xor(get(x), get(w1))),
    ...set(y, xor(get(y), get(v0))),
    ...set(z, rotr(xor(get(z), get(w0)), n(33))),
    // v = WeakHashLen32WithSeeds(s, v1 * k1, x + w0)
    ...call(WEAK, get(s), mul(get(v1), k(K1)), add(get(x), get(w0))),
    ...set(v0, gget(G0)),
    ...set(v1, gget(G1)),
    // w = WeakHashLen32WithSeeds(s + 32, z + w1, y)
    ...call(WEAK, add32(get(s), i32(32)), add(get(z), get(w1)), get(y)),
    ...set(w0, gget(G0)),
    ...set(w1, gget(G1)),
    // std::swap(z, x)
    ...set(t, get(z)),
    ...set(z, get(x)),
    ...set(x, get(t)),
    ...set(s, add32(get(s), i32(64))),
  ];
  const fromEnd = (offset: number): Code =>
    add32(sub32(add32(get(s), get(len)), get(tail)), i32(offset));
  functions[WITH_SEED] = {
    params: [I32, I32, I64, I64],
    results: [],
    locals: [I64, I64, I64, I64, I64, I64, I32],
    body: [
      ...ifThen(lt32(get(len), i32(128)), [
        ...call(CITY_MURMUR, get(s), get(len), get(x), get(y)),
        ...RETURN,
      ]),
      ...set(z, mul(ext(get(len)), k(K1))),
      ...set(v0, add(mul(rotr(xor(get(y), k(K1)), n(49)), k(K1)), at(0))),
      ...set(v1, add(mul(rotr(get(v0), n(42)), k(K1)), at(8))),
      ...set(w0, add(mul(rotr(add(get(y), get(z)), n(35)), k(K1)), get(x))),
      ...set(w1, mul(rotr(add(get(x), at(88)), n(53)), k(K1))),
      ...doWhile(
        [...half, ...half, ...set(len, sub32(get(len), i32(128)))],
        ge32(get(len), i32(128)),
      ),
      // y += Rotate(w0, 37) * k0 + z
      ...set(y, add(get(y), add(mul(rotr(get(w0), n(37)), k(K0)), get(z)))),
      // x += Rotate(v0 + z, 49) * k0
      ...set(x, add(get(x), mul(rotr(add(get(v0), get(z)), n(49)), k(K0)))),
      // for (tail_done = 0; tail_done < len; )
      ...set(tail, i32(0)),
      0x02,
      VOID,
      0x03,
      VOID,
      ...ge32(get(tail), get(len)),
      0x0d,
      1,
      ...set(tail, add32(get(tail), i32(32))),
      ...set(y, add(mul(rotr(sub(get(y), get(x)), n(42)), k(K0)), get(v1))),
      ...set(w0, add(get(w0), load64(fromEnd(16)))),
      ...set(x, add(mul(rotr(get(x), n(49)), k(K0)), get(w0))),
      ...set(w0, add(get(w0), get(v0))),
      ...call(WEAK, fromEnd(0), get(v0), get(v1)),
      ...set(v0, gget(G0)),
      ...set(v1, gget(G1)),
      0x0c,
      0,
      0x0b,
      0x0b,
      ...set(x, call(HASH_LEN_16, get(x), get(v0))),
      ...set(y, call(HASH_LEN_16, get(y), get(w0))),
      ...gset(
        G0,
        add(call(HASH_LEN_16, add(get(x), get(v1)), get(w1)), get(y)),
      ),
      ...gset(
        G1,
        call(HASH_LEN_16, add(get(x), get(w1)), add(get(y), get(v1))),
      ),
    ],
  };
}

// hash(s, len): CityHash128(s, len) to memory[0..16] (low, then high)
{
  const [s, len] = [0, 1];
  functions.push({
    params: [I32, I32],
    results: [],
    locals: [],
    body: [
      ...ge32(get(len), i32(16)),
      0x04,
      VOID,
      ...call(
        WITH_SEED,
        add32(get(s), i32(16)),
        sub32(get(len), i32(16)),
        xor(load64(get(s)), k(K3)),
        load64(add32(get(s), i32(8))),
      ),
      0x05,
      ...ge32(get(len), i32(8)),
      0x04,
      VOID,
      ...call(
        WITH_SEED,
        get(s),
        i32(0),
        xor(load64(get(s)), mul(ext(get(len)), k(K0))),
        xor(load64(sub32(add32(get(s), get(len)), i32(8))), k(K1)),
      ),
      0x05,
      ...call(WITH_SEED, get(s), get(len), k(K0), k(K1)),
      0x0b,
      0x0b,
      ...store64(i32(0), gget(G0)),
      ...store64(i32(8), gget(G1)),
    ],
  });
}

function section(id: number, content: Code): Code {
  return [id, ...uleb(content.length), ...content];
}

function vec(items: Code[]): Code {
  return [...uleb(items.length), ...items.flat()];
}

function str(s: string): Code {
  return vec([...Buffer.from(s)].map((b) => [b]));
}

function moduleBytes(): Uint8Array<ArrayBuffer> {
  const types = functions.map((f) => [
    0x60,
    ...vec(f.params.map((p) => [p])),
    ...vec(f.results.map((r) => [r])),
  ]);
  const codes = functions.map((f) => {
    const locals = vec(f.locals.map((type) => [1, type]));
    const body = [...locals, ...f.body, 0x0b];
    return [...uleb(body.length), ...body];
  });
  const global = [I64, 0x01, ...k(0n), 0x0b];
  return Uint8Array.from([
    ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
    ...section(1, vec(types)),
    ...section(3, vec(functions.map((_, i) => uleb(i)))),
    ...section(5, vec([[0x00, 1]])), // memory: at least one page
    ...section(6, vec([global, global])),
    ...section(
      7,
      vec([
        [...str("memory"), 0x02, 0],
        [...str("hash"), 0x00, ...uleb(functions.length - 1)],
      ]),
    ),
    ...section(10, vec(codes)),
  ]);
}

interface CityHashWasm {
  memory: WebAssembly.Memory;
  hash: (offset: number, length: number) => void;
}

/** The input starts after the 16 bytes of the result. */
const INPUT_OFFSET = 16;
const PAGE_SIZE = 65536;
/** The largest input for WebAssembly. The JavaScript version hashes a
 *  larger input. */
const MAX_WASM_INPUT = 0x7fff0000;
/**
 * The memory of a WebAssembly instance can grow, but it cannot become
 * smaller. The instance that the module keeps is only for inputs up to this
 * size (a compressed block has about 1 MiB), so its memory stays small. A
 * larger input uses a second instance, which the module holds only with a
 * weak reference: the next large inputs use it again, and the garbage
 * collector releases it with its memory.
 */
const KEPT_INSTANCE_MAX_INPUT = 4 * 1024 * 1024 - INPUT_OFFSET;

let compiled: WebAssembly.Module | null | undefined;
let kept: CityHashWasm | null | undefined;
let large: WeakRef<CityHashWasm> | undefined;
let wasmEnabled = true;

/** Makes a new instance (one page of memory), or `null` without WebAssembly. */
function instantiate(): CityHashWasm | null {
  if (compiled === undefined) {
    try {
      compiled = new WebAssembly.Module(moduleBytes());
    } catch {
      compiled = null;
    }
  }
  if (compiled === null) return null;
  try {
    return new WebAssembly.Instance(compiled, {})
      .exports as unknown as CityHashWasm;
  } catch {
    return null;
  }
}

function keptInstance(): CityHashWasm | null {
  if (kept === undefined) kept = instantiate();
  return kept;
}

function largeInstance(): CityHashWasm | null {
  let instance = large?.deref() ?? null;
  if (instance === null) {
    instance = instantiate();
    large = instance === null ? undefined : new WeakRef(instance);
  }
  return instance;
}

/** CityHash128 v1.0.2 as 16 bytes: the low 64 bits, then the high 64 bits,
 *  both little-endian (the layout of the checksum in a compressed block). */
export function cityHash128(data: Uint8Array): Buffer {
  if (!wasmEnabled || data.length > MAX_WASM_INPUT) {
    return cityHash128JS(data);
  }
  const m =
    data.length <= KEPT_INSTANCE_MAX_INPUT ? keptInstance() : largeInstance();
  if (m === null) return cityHash128JS(data);
  const needed = INPUT_OFFSET + data.length;
  const size = m.memory.buffer.byteLength;
  if (size < needed) {
    try {
      m.memory.grow(Math.ceil((needed - size) / PAGE_SIZE));
    } catch {
      // The runtime cannot give this much memory to WebAssembly.
      return cityHash128JS(data);
    }
  }
  new Uint8Array(m.memory.buffer, INPUT_OFFSET, data.length).set(data);
  m.hash(INPUT_OFFSET, data.length);
  return Buffer.from(new Uint8Array(m.memory.buffer, 0, 16));
}

/** True if the hash runs in WebAssembly (for the tests). */
export function cityHashUsesWasm(): boolean {
  return wasmEnabled && keptInstance() !== null;
}

/** Turns the WebAssembly version on or off (for the tests of the JavaScript
 *  version). Returns the value before the call. */
export function setCityHashWasmEnabled(enabled: boolean): boolean {
  const before = wasmEnabled;
  wasmEnabled = enabled;
  return before;
}
