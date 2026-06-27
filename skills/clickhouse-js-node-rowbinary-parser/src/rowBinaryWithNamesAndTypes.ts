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
import { astToReader, RowBinaryTypeError } from "./compile.js";

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
 * {@link RowBinaryTypeError} if the parser rejects the string (e.g. the
 * deliberately unsupported `AggregateFunction` / `SimpleAggregateFunction`) —
 * carrying the `typeString` and the parse `position`.
 */
export function typeStringToReader(typeStr: string): Reader<unknown> {
  const result = parseDataType(typeStr);
  if (!result.ok()) {
    const err = result.error!;
    throw new RowBinaryTypeError(
      `cannot compile type ${JSON.stringify(typeStr)}: ${err.message}`,
      { typeString: typeStr, position: err.position },
    );
  }
  return astToReader(result.ast!);
}

/** Resolves a ClickHouse type string to a reader — `typeStringToReader` or a cache wrapping it. */
export type TypeReaderResolver = (typeStr: string) => Reader<unknown>;

/**
 * Build an LRU-cached {@link typeStringToReader}. The full ClickHouse type
 * STRING is a perfect cache key: two columns of the same type compile to the
 * same reader, and a reader is stateless (it only ever touches the cursor it is
 * handed), so one instance is safe to share across columns and across streams —
 * a cache hit skips the parse + AST fold entirely.
 *
 * Worth it when you decode many `RowBinaryWithNamesAndTypes` responses whose
 * schemas overlap (e.g. the same query run repeatedly): keep one cache and pass
 * it to {@link compileRowBinaryWithNamesAndTypes}, so a recurring type is
 * compiled once rather than once per response. A single response rarely repeats
 * a type across its own columns, so the win is across calls, not within one.
 *
 * Classic Map-based LRU: a `Map` iterates in insertion order, so on a HIT we
 * delete + re-set the entry to move it to the most-recently-used end, and on
 * overflow we evict the oldest key (the first the `Map` yields). `maxSize` caps
 * memory. A parse FAILURE is never cached — {@link typeStringToReader} throws
 * before anything is stored — so fixing a bad type is not shadowed by a cached
 * error.
 */
export function createTypeReaderCache(maxSize = 256): TypeReaderResolver {
  const cache = new Map<string, Reader<unknown>>();
  return (typeStr) => {
    const cached = cache.get(typeStr);
    if (cached !== undefined) {
      // Touch on hit. A Map iterates in INSERTION order, not usage order — so on
      // its own `keys().next()` would give the oldest-added key, not the
      // least-recently-USED one. Deleting and re-inserting moves this key to the
      // tail, which is what turns insertion order INTO recency order: every
      // access (hit here, or miss below) lands the key at the tail, leaving the
      // head as the genuine least-recently-used entry.
      cache.delete(typeStr);
      cache.set(typeStr, cached);
      return cached;
    }
    const reader = typeStringToReader(typeStr); // may throw — then nothing is cached
    cache.set(typeStr, reader);
    if (cache.size > maxSize) {
      // The head is the least-recently-used key (see touch-on-hit above), so it
      // is the correct one to evict.
      const lru = cache.keys().next().value;
      if (lru !== undefined) cache.delete(lru);
    }
    return reader;
  };
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
 *
 * Pass `resolveType` to reuse readers across calls — e.g. a shared
 * {@link createTypeReaderCache}. It defaults to {@link typeStringToReader}
 * (compile every column afresh).
 */
export function compileRowBinaryWithNamesAndTypes(
  state: Cursor,
  resolveType: TypeReaderResolver = typeStringToReader,
): CompiledStream {
  const { names, types } = readHeader(state);
  const columnReaders = types.map((t) => resolveType(t));

  const fields: Record<string, Reader<unknown>> = {};
  for (let i = 0; i < names.length; i++) fields[names[i]!] = columnReaders[i]!;
  const readRow = readTupleNamed(fields);

  return { names, types, columnReaders, readRow, readRows: readRows(readRow) };
}
