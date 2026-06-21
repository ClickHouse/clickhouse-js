/**
 * Thrown by {@link advance} when the buffer does not yet hold the bytes a read
 * needs — the "need more bytes" signal for incremental decoding over a buffer
 * that is still filling. A driver catches it (`err === NeedMoreData`), waits for
 * more input, and retries the row from its last committed position.
 *
 * It is a bare sentinel, NOT an `Error` subclass, on purpose: constructing an
 * Error captures a stack trace, which is the expensive part of throwing, and on
 * a decode path that starves once per chunk that cost is pure waste. Throwing a
 * constant value skips it — see `streamingRow.bench.ts`, where throw + restart
 * beats a generator's yield for realistic chunk sizes precisely because the
 * throw is this cheap.
 */
export const NeedMoreData = Symbol("RowBinary.NeedMoreData");

/**
 * The cursor state every reader function threads through. Holds the input
 * `Buffer`, the current position, and a `DataView` over the same bytes.
 *
 * This is deliberately just STATE — no read methods. Decoding lives in the free
 * `readX(state, ...)` functions in the sibling modules, so a generated parser
 * pulls in only the per-type readers a result actually needs (and the readers
 * compose without a class). `view` and `buf` are public so those free functions
 * can reach them.
 */
export class RowBinaryState {
  pos = 0;

  /**
   * `DataView` over the same bytes, used for fixed-width integer/float reads.
   *
   * Built with the buffer's own `byteOffset`/`byteLength`: a `Buffer` is often a
   * window into a larger pooled `ArrayBuffer`, so `new DataView(buf.buffer)`
   * alone would point at the wrong bytes.
   */
  readonly view: DataView;

  /**
   * Node-only skill, so the input is a `Buffer`: number reads go through
   * {@link RowBinaryState.view} (DataView), while `String`/`FixedString` use the
   * fast `buf.toString("utf8", ...)`.
   *
   * Declared as an explicit field (not a constructor parameter property) so the
   * class compiles under `erasableSyntaxOnly` — the same TS constraint the main
   * packages enforce — keeping it copy/paste-safe for downstream code.
   */
  readonly buf: Buffer;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }
}

/**
 * A `Reader<T>` decodes one value of type `T` from the cursor, advancing it.
 * Leaf readers (e.g. `readUInt32`) are `Reader`s directly; combinators (e.g.
 * `readArray`) take sub-`Reader`s and RETURN a `Reader`, so types compose with
 * no per-element closures:
 *
 *   readArray(readUInt32)(state)                 // number[]
 *   readArray(readTupleNamed({ a: readUInt8 }))  // a Reader<{a:number}[]>
 */
export type Reader<T> = (state: RowBinaryState) => T;

/**
 * Reserve `n` bytes for the next read: bounds-check them, advance the cursor
 * past them, and return the offset the read should start at (the cursor's value
 * BEFORE advancing — the "last position"). Every fixed-width read goes through
 * this, so the one length check and the cursor bookkeeping live in a single
 * place:
 *
 *   function readInt32(s) { return s.view.getInt32(advance(s, 4), true); }
 *
 * Throws {@link NeedMoreData} when fewer than `n` bytes remain. The cursor is
 * NOT moved in that case, so a driver that catches it can rewind to its last
 * committed row and retry once more bytes arrive.
 *
 * SAFE TO TOGGLE: this skill's default is a complete, in-memory buffer where the
 * check never fires. A parser generated for that case can drop `advance` and
 * read against `state.pos` directly (the original no-bounds-check form), trading
 * streaming tolerance for one fewer compare per read.
 */
export function advance(state: RowBinaryState, n: number): number {
  const start = state.pos;
  const next = start + n;
  if (next > state.buf.length) throw NeedMoreData;
  state.pos = next;
  return start;
}
