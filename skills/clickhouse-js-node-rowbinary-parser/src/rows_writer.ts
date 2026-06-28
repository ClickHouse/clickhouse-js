import { BufferFull, type Sink, type Writer } from "./core_writer.js";

/**
 * Drive `writeRow` over every row of an iterable into a plain `RowBinary` payload
 * — the encode mirror of `readRows`. Rows are concatenated with NO count, length
 * prefix, or delimiter (just as the reader expects), so `writeRow` must emit
 * EXACTLY one row's bytes. Curried: `writeRows(writeRow)` returns the driver.
 *
 * Returns a GENERATOR rather than a `Writer<readonly T[]>` on purpose. The sink
 * wraps a FIXED-length buffer, so a large (or unbounded) result won't fit in one
 * pass — when a row would overflow, `writeRow` throws {@link BufferFull} from
 * `reserve`, and a plain `(sink, rows) => void` would let that escape mid-row,
 * leaving the caller unable to tell how many rows actually made it in. Instead
 * this catches `BufferFull`, rewinds `pos` to the last COMPLETE row boundary
 * (never a half-written row), and `yield`s the full buffer for the caller to
 * flush; on resume it resets `pos` and retries the row that didn't fit. Rows is
 * an `Iterable<T>`, not a fixed array, so the same driver handles a future
 * infinite/streaming row source unchanged.
 *
 * The driver loop — `for...of` flushes each full buffer, then flush the trailing
 * partial buffer once the generator is exhausted:
 *
 *   const drive = writeRows(writeRow);
 *   const sink = new Sink(Buffer.allocUnsafe(64 * 1024));
 *   for (const full of drive(sink, rows)) send(full); // each yielded buffer is full
 *   send(sink.bytes());                               // the trailing, partial buffer
 *
 * Each yielded `Buffer` is a zero-copy VIEW into the sink (see {@link Sink.bytes})
 * that the generator overwrites as soon as it resumes, so consume it (write/copy)
 * BEFORE pulling the next value — a `for...of` body does exactly that. The
 * generator owns the `pos` bookkeeping: it rewinds on overflow and resets to 0
 * after each yield, so the caller only flushes.
 *
 * When generating code, inline the per-column writes into the loop body,
 * mirroring the reader.
 *
 * @throws if a single row can't fit in an empty buffer — it never will, so rather
 * than spin forever this throws. Size the sink buffer above your largest row.
 */
export function writeRows<T>(
  writeRow: Writer<T>,
): (sink: Sink, rows: Iterable<T>) => Generator<Buffer, void, void> {
  return function* (sink, rows) {
    for (const row of rows) {
      let committed = sink.pos; // start of this row — the last clean boundary
      while (true) {
        try {
          writeRow(sink, row);
          break; // row written cleanly — on to the next
        } catch (e) {
          if (e !== BufferFull) throw e;
          sink.pos = committed; // drop the partially written row
          if (committed === 0)
            // an empty buffer couldn't hold even this one row — it never will
            throw new Error(
              "RowBinary writeRows: a single row exceeds the sink buffer; enlarge the buffer",
            );
          yield sink.bytes(); // hand the full buffer over; caller flushes it
          sink.pos = committed = 0; // buffer flushed — retry the row from the top
        }
      }
    }
  };
}
