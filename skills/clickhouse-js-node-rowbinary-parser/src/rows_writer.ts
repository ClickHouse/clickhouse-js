import { type Writer } from "./core_writer.js";

/**
 * Drive `writeRow` over every row of an array into a plain `RowBinary` payload —
 * the encode mirror of `readRows`. Rows are concatenated with NO count, length
 * prefix, or delimiter (just as the reader expects), so `writeRow` must emit
 * EXACTLY one row's bytes. Curried: `writeRows(writeRow)` returns a
 * `Writer<readonly T[]>`.
 *
 * When generating code, inline the per-column writes into the loop body,
 * mirroring the reader.
 */
export function writeRows<T>(writeRow: Writer<T>): Writer<readonly T[]> {
  return (sink, rows) => {
    for (const row of rows) writeRow(sink, row);
  };
}
