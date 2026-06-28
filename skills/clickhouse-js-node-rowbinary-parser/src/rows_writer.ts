import { BufferFull, Sink, type Writer } from "./core_writer.js";

/** Default sink size when `writeRows` isn't given one — a typical flush chunk. */
const DEFAULT_BUFFER_SIZE = 64 * 1024;

/**
 * Drive `writeRow` over every row of an iterable into a plain `RowBinary` payload
 * — the encode mirror of `readRows`. Rows are concatenated with NO count, length
 * prefix, or delimiter (just as the reader expects), so `writeRow` must emit
 * EXACTLY one row's bytes. Curried: `writeRows(writeRow)` returns the driver.
 *
 * Returns a GENERATOR rather than a `Writer<readonly T[]>` on purpose. A `Sink`
 * wraps a FIXED-length buffer, so a large (or unbounded) result won't fit in one
 * pass — when a row would overflow, `writeRow` throws {@link BufferFull} from
 * `reserve`, and a plain `(sink, rows) => void` would let that escape mid-row,
 * leaving the caller unable to tell how many rows actually made it in. Instead
 * this owns the sink: it catches `BufferFull`, rewinds to the last COMPLETE row
 * boundary (never a half-written row), `yield`s that buffer, and starts a FRESH
 * `Sink` for the rows that didn't fit. Because each flush gets its own buffer,
 * every yielded `Buffer` stays valid after the generator resumes — safe to retain
 * or hand to an async sink, no copy needed. The caller supplies a `bufferSize`,
 * not a sink, and `rows` is an `Iterable<T>` (not a fixed array), so the same
 * driver handles a future infinite/streaming row source unchanged.
 *
 * The driver loop is just a `for...of` — the generator yields every buffer
 * including the trailing partial one, so there's nothing to flush afterwards:
 *
 *   const drive = writeRows(writeRow);
 *   for (const chunk of drive(rows, 64 * 1024)) send(chunk);
 *
 * When generating code, inline the per-column writes into the loop body,
 * mirroring the reader.
 *
 * @throws if a single row can't fit an empty buffer — it never will, so rather
 * than spin forever this throws. Set `bufferSize` above your largest row.
 */
export function writeRows<T>(
  writeRow: Writer<T>,
): (rows: Iterable<T>, bufferSize?: number) => Generator<Buffer, void, void> {
  return function* (rows, bufferSize = DEFAULT_BUFFER_SIZE) {
    let sink = new Sink(Buffer.allocUnsafe(bufferSize));
    for (const row of rows) {
      while (true) {
        const committed = sink.pos; // start of this row — the last clean boundary
        try {
          writeRow(sink, row);
          break; // row written cleanly — on to the next
        } catch (e) {
          if (e !== BufferFull) throw e;
          if (committed === 0)
            // an empty buffer couldn't hold even this one row — it never will
            throw new Error(
              "RowBinary writeRows: a single row exceeds the sink buffer; enlarge bufferSize",
            );
          sink.pos = committed; // drop the partially written row, then flush
          yield sink.bytes();
          sink = new Sink(Buffer.allocUnsafe(bufferSize)); // fresh buffer; retry the row
        }
      }
    }
    if (sink.pos > 0) yield sink.bytes(); // the trailing, partial buffer
  };
}
