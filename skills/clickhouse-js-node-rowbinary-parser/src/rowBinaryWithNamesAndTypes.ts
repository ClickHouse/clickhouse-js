/**
 * The `RowBinaryWithNamesAndTypes` entry point: read the header off a cursor,
 * compile each column's type string into a reader, and hand back a driver that
 * decodes the rest of the stream.
 *
 * This ties together the pieces: {@link readHeader} (wire), the parser
 * (`@clickhouse/datatype-parser`), and {@link astToReader} (the AST → reader
 * fold in `compile.ts`), then assembles a named-tuple row reader over the
 * columns and a {@link readRows} driver for the row data.
 */

import { parseDataType } from "@clickhouse/datatype-parser";

import type { Reader, Cursor } from "./core.js";
import { readHeader } from "./header.js";
import { readTupleNamed } from "./composite.js";
import { readRows } from "./rows.js";
import { astToReader } from "./compile.js";

/** One decoded row, keyed by column name. */
export type Row = Record<string, unknown>;

/**
 * The product of compiling a `RowBinaryWithNamesAndTypes` header: the column
 * metadata, the per-column readers, and — the headline — `readRows`, the
 * {@link Reader} that decodes every remaining row of the stream.
 */
export interface CompiledStream {
  /** Column names, in stream order (from the header). */
  names: string[];
  /** Column type strings, in stream order (from the header). */
  types: string[];
  /** One folded reader per column, in stream order. */
  columnReaders: Reader<unknown>[];
  /** Reads exactly one row into a `{ [name]: value }` object. */
  readRow: Reader<Row>;
  /**
   * Reads the REST of the stream (all rows after the header) into an array.
   * Streaming-aware via {@link readRows}: on a partial trailing row it rewinds
   * to the last complete row and returns what it has.
   */
  readRows: Reader<Row[]>;
}

/**
 * Parse one ClickHouse type string and fold it into a {@link Reader}. Throws a
 * descriptive error if the parser rejects the string (e.g. the deliberately
 * unsupported `AggregateFunction` / `SimpleAggregateFunction`).
 */
export function typeStringToReader(typeStr: string): Reader<unknown> {
  const result = parseDataType(typeStr);
  if (!result.ok()) {
    const err = result.error!;
    throw new Error(
      `cannot compile type ${JSON.stringify(typeStr)}: ${err.message} (at position ${err.position})`,
    );
  }
  return astToReader(result.ast!);
}

/**
 * The headline entry point. Reads the `RowBinaryWithNamesAndTypes` header off
 * `state`, compiles each column type into a combinator reader, and returns the
 * column metadata plus the readers — including `readRows`, the reader for the
 * REST of the stream. After this call the cursor sits at the first row, so:
 *
 *   const s = new Cursor(buf);
 *   const { names, readRows } = compileRowBinaryWithNamesAndTypes(s);
 *   const rows = readRows(s);   // decode every remaining row
 */
export function compileRowBinaryWithNamesAndTypes(
  state: Cursor,
): CompiledStream {
  const { names, types } = readHeader(state);
  const columnReaders = types.map(typeStringToReader);

  const fields: Record<string, Reader<unknown>> = {};
  for (let i = 0; i < names.length; i++) fields[names[i]!] = columnReaders[i]!;
  const readRow = readTupleNamed(fields);

  return { names, types, columnReaders, readRow, readRows: readRows(readRow) };
}
