/**
 * Thrown by {@link advance} when the buffer lacks the bytes a read needs — the
 * "need more bytes" signal for incremental decoding over a still-filling buffer.
 * A driver catches it (`err === NeedMoreData`), waits for more input, and retries
 * the row from its last committed position.
 *
 * A bare sentinel, NOT an `Error` subclass, on purpose: constructing an Error
 * captures a stack trace — the expensive part of throwing — and on a path that
 * starves once per chunk that cost is pure waste. Throwing a constant skips it,
 * which is why throw + restart beats a generator's yield for realistic chunks
 * (see `streamingRow.bench.ts`).
 */
export const NeedMoreData = Symbol("RowBinary.NeedMoreData");

/**
 * The cursor state every reader threads through: the input `Buffer`, the current
 * position, and a `DataView` over the same bytes.
 *
 * Deliberately STATE only — no read methods. Decoding lives in the free
 * `readX(state, ...)` functions in the sibling modules, so a generated parser
 * pulls in only the per-type readers a result needs. `view`/`buf` are public so
 * those free functions can reach them.
 */
export class Cursor {
  pos = 0;

  /**
   * Node-only skill, so the input is a `Buffer`: number reads go through
   * {@link Cursor.view} (DataView), while `String`/`FixedString` use the
   * fast `buf.toString("utf8", ...)`.
   */
  readonly buf: Buffer;

  /**
   * `DataView` over the same bytes, for fixed-width integer/float reads. Built
   * with the buffer's own `byteOffset`/`byteLength`: a `Buffer` is often a window
   * into a larger pooled `ArrayBuffer`, so `new DataView(buf.buffer)` alone would
   * point at the wrong bytes.
   */
  readonly view: DataView;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
}

/**
 * A `Reader<T>` decodes one value of type `T` from the cursor, advancing it. Leaf
 * readers (e.g. `readUInt32`) are `Reader`s directly; combinators (e.g.
 * `readArray`) take sub-`Reader`s and return a `Reader`, so types compose with no
 * per-element closures.
 */
export type Reader<T> = (state: Cursor) => T;

/**
 * Reserve `n` bytes for the next read: bounds-check them, advance the cursor past
 * them, and return the offset the read starts at (the value BEFORE advancing).
 * Every fixed-width read goes through this, so the length check and cursor
 * bookkeeping live in one place:
 *
 *   function readInt32(s) { return s.view.getInt32(advance(s, 4), true); }
 *
 * Throws {@link NeedMoreData} when fewer than `n` bytes remain, WITHOUT moving the
 * cursor, so a driver can rewind to its last committed row and retry.
 *
 * SAFE TO TOGGLE: for a complete in-memory buffer the check never fires — a parser
 * for that case can drop `advance` and read against `state.pos` directly, trading
 * streaming tolerance for one fewer compare per read.
 */
export function advance(state: Cursor, n: number): number {
  const start = state.pos;
  const next = start + n;
  if (next > state.buf.length) throw NeedMoreData;
  state.pos = next;
  return start;
}

/**
 * The write-side mirror of {@link Cursor}: the cursor every writer threads
 * through. A growable output `Buffer` plus a `DataView` over the same bytes and
 * the current write position. The encode counterpart of decode's `Cursor`.
 *
 * Deliberately STATE only — no write methods. Encoding lives in the free
 * `writeX(sink, value)` functions in the sibling modules, so a generated encoder
 * pulls in only the per-type writers a result needs (exactly like the reader
 * side). `view`/`buf` are public so those free functions can reach them.
 *
 * Unlike a `Cursor` — whose `buf` is the fixed input and whose reads only ever
 * shrink the remaining bytes — a `Sink` GROWS: {@link reserve} reallocates a
 * larger buffer (and rebuilds {@link Sink.view}) when the next write would
 * overflow, so callers never size the buffer up front. Pull the finished bytes
 * with {@link Sink.bytes}.
 */
export class Sink {
  pos = 0;

  /**
   * The backing store. NOT the final output — it is over-allocated headroom that
   * {@link reserve} grows on demand; only `buf.subarray(0, pos)` (see
   * {@link Sink.bytes}) holds written bytes. Reassigned by {@link reserve} on a
   * grow, so never cache it across a write.
   */
  buf: Buffer;

  /**
   * `DataView` over {@link Sink.buf}, for fixed-width integer/float writes. Built
   * with the buffer's own `byteOffset`/`byteLength` (a `Buffer` is often a window
   * into a larger pooled `ArrayBuffer`), and rebuilt alongside `buf` whenever
   * {@link reserve} grows, so it always covers the live buffer.
   */
  view: DataView;

  constructor(initialCapacity = 256) {
    this.buf = Buffer.allocUnsafe(initialCapacity);
    this.view = new DataView(
      this.buf.buffer,
      this.buf.byteOffset,
      this.buf.byteLength,
    );
  }

  /**
   * The written bytes — `buf.subarray(0, pos)`. A zero-copy VIEW into the
   * sink's backing buffer, so a later {@link reserve} that grows the sink
   * reallocates and leaves this view pointing at the OLD bytes: pull `bytes()`
   * only once writing is done, or `Buffer.from(sink.bytes())` to copy it out.
   */
  bytes(): Buffer {
    return this.buf.subarray(0, this.pos);
  }
}

/**
 * A `Writer<T>` encodes one value of type `T` into the sink, advancing it — the
 * mirror of {@link Reader}. Leaf writers (e.g. `writeUInt32`) are `Writer`s
 * directly; combinators (e.g. `writeArray`) take sub-`Writer`s and return a
 * `Writer`, so types compose with no per-element closures.
 */
export type Writer<T> = (sink: Sink, value: T) => void;

/**
 * Reserve `n` bytes for the next write: ensure the buffer has room (growing it
 * if not), advance the position past them, and return the offset the write
 * starts at (the value BEFORE advancing). The write-side mirror of
 * {@link advance}: every fixed-width write goes through it, so the capacity check
 * and position bookkeeping live in one place:
 *
 *   function writeInt32(s, v) { s.view.setInt32(reserve(s, 4), v, true); }
 *
 * Where `advance` THROWS on underflow (the input is fixed), `reserve` GROWS on
 * overflow (the output is owned): it at least doubles the capacity until `n` more
 * bytes fit, copies the written prefix into the new buffer, and rebuilds
 * {@link Sink.view}. Amortized O(1) per byte.
 *
 * GOTCHA — a grow REPLACES `sink.buf` and `sink.view`, so always capture the
 * offset BEFORE indexing them: write `const o = reserve(s, 4); s.view.setInt32(o,
 * v, true)`, never `s.view.setInt32(reserve(s, 4), v, true)` (the latter
 * evaluates `s.view` first and would target the discarded buffer on a grow).
 */
export function reserve(sink: Sink, n: number): number {
  const start = sink.pos;
  const next = start + n;
  if (next > sink.buf.length) {
    let capacity = sink.buf.length * 2;
    while (capacity < next) capacity *= 2;
    const grown = Buffer.allocUnsafe(capacity);
    sink.buf.copy(grown, 0, 0, start);
    sink.buf = grown;
    sink.view = new DataView(
      grown.buffer,
      grown.byteOffset,
      grown.byteLength,
    );
  }
  sink.pos = next;
  return start;
}
