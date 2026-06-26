/**
 * A compiler-like bridge from a ClickHouse type STRING to a RowBinary
 * {@link Reader}. Given the `RowBinaryWithNamesAndTypes` header — the column
 * names and their type strings the server writes before the row data — it:
 *
 *   1. reads the header off the cursor (column count, names, type strings),
 *   2. parses each type string into an AST with `@clickhouse/datatype-parser`,
 *   3. FOLDS that AST into a tree of combinator calls from this library
 *      (`readArray(readNullable(readUInt32))`, `readMap(readString, ...)`, …),
 *   4. wraps the per-column readers in a named-tuple row reader and hands back a
 *      {@link readRows} driver that decodes the REST of the stream.
 *
 * This is the unoptimized reference path: it composes the existing GENERIC
 * curried combinators at runtime, exactly as a hand-written reader would. There
 * is no code generation and no monomorphization here — those are the deliberate
 * next step (see the `MONOMORPHIZE` notes throughout the combinator modules).
 * The point of this module is just the faithful AST → combinator fold.
 *
 * The fold mirrors {@link readDynamicType} in `dynamic.ts`, which performs the
 * same "type → Reader" mapping but driven by ClickHouse's BINARY type encoding;
 * here the driver is the textual type and its parsed AST.
 */

import {
  parseDataType,
  NodeKind,
  type Node,
} from "@clickhouse/datatype-parser";

import type { Reader, Cursor } from "./core.js";
import { readUVarint } from "./varint.js";
import {
  readInt8,
  readInt16,
  readInt32,
  readInt64,
  readInt128,
  readInt256,
  readUInt8,
  readUInt16,
  readUInt32,
  readUInt64,
  readUInt128,
  readUInt256,
} from "./integers.js";
import { readFloat32, readFloat64, readBFloat16 } from "./floats.js";
import { readBool } from "./bool.js";
import { readString, readFixedString } from "./strings.js";
import { readUUID } from "./uuid.js";
import { readIPv4, readIPv6 } from "./ip.js";
import {
  readDate,
  readDate32,
  readDateTime,
  readDateTime64,
} from "./datetime.js";
import { readTime, readTime64 } from "./time.js";
import { readInterval } from "./interval.js";
import {
  readDecimal32,
  readDecimal64,
  readDecimal128,
  readDecimal256,
} from "./decimals.js";
import { readEnum8, readEnum16 } from "./enums.js";
import {
  readArray,
  readMap,
  readNullable,
  readTuple,
  readTupleNamed,
  readVariant,
  readQBit,
} from "./composite.js";
import { readLowCardinality } from "./lowCardinality.js";
import { readNested } from "./nested.js";
import { readNothing } from "./nothing.js";
import {
  readPoint,
  readRing,
  readLineString,
  readPolygon,
  readMultiLineString,
  readMultiPolygon,
  readGeometry,
} from "./geo.js";
import { readJSON } from "./json.js";
import { readDynamic } from "./dynamic.js";
import { readRows } from "./rows.js";

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
 * Read the `RowBinaryWithNamesAndTypes` header off the cursor: a LEB128 column
 * count, then that many column-name `String`s, then that many type-string
 * `String`s. Leaves the cursor at the first row's bytes.
 */
export function readHeader(state: Cursor): {
  names: string[];
  types: string[];
} {
  const count = readUVarint(state);
  const names: string[] = new Array(count);
  for (let i = 0; i < count; i++) names[i] = readString(state);
  const types: string[] = new Array(count);
  for (let i = 0; i < count; i++) types[i] = readString(state);
  return { names, types };
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
 * The fold itself: turn a parsed type-AST node into a value {@link Reader},
 * recursing into element / key / field types for composites. The shape mirrors
 * the server's `EXPLAIN AST` data-type subtree (see the parser's `ast.ts`).
 */
export function astToReader(node: Node): Reader<unknown> {
  switch (node.kind) {
    case NodeKind.EnumDataType:
      // Explicit-value enum: the wire value is the underlying int; the
      // name<->value map is metadata we don't need to decode.
      return node.name === "Enum16" ? readEnum16 : readEnum8;
    case NodeKind.TupleDataType:
      return tupleReader(node);
    case NodeKind.DataType:
      return dataTypeReader(node);
    default:
      // Literal / Function / Identifier / NameTypePair are argument nodes,
      // consumed by their parent — never a standalone column type.
      throw new Error(
        `cannot build a column reader for a ${node.kind} node (${node.name || "?"})`,
      );
  }
}

/**
 * Fold a generic `DataType` node (`name` + optional `arguments`) — the bulk of
 * the type system: scalars, the parameterized types, and the
 * wrappers/composites that recurse through {@link astToReader}.
 */
function dataTypeReader(node: Node): Reader<unknown> {
  switch (node.name) {
    // --- wrappers & composites (recurse into argument types) ---
    case "Nullable":
      return readNullable(astToReader(requireArg(node, 0)));
    case "LowCardinality":
      // Transparent in RowBinary: just the inner type's reader.
      return readLowCardinality(astToReader(requireArg(node, 0)));
    case "Array":
      return readArray(astToReader(requireArg(node, 0)));
    case "QBit":
      // QBit(element_type, dimension): wire-identical to Array(element_type);
      // the dimension (arg 1) is metadata, not in the value stream.
      return readQBit(astToReader(requireArg(node, 0)));
    case "Map":
      return readMap(
        astToReader(requireArg(node, 0)),
        astToReader(requireArg(node, 1)),
      );
    case "Variant":
      return variantReader(node);
    case "Nested":
      return nestedReader(node);

    // --- parameterized scalars ---
    case "FixedString":
      return readFixedString(literalInt(requireArg(node, 0)));
    case "DateTime":
    case "DateTime32":
      // An optional timezone argument is metadata; the value wire is the same.
      return readDateTime;
    case "DateTime64":
      // DateTime64(P [, 'tz']); default precision 3 if somehow omitted.
      return readDateTime64(
        node.arguments.length > 0 ? literalInt(node.arguments[0]!) : 3,
      );
    case "Time64":
      return readTime64(literalInt(requireArg(node, 0)));
    case "Decimal":
      return decimalReader(node);
    case "Decimal32":
      return readDecimal32(literalInt(requireArg(node, 0)));
    case "Decimal64":
      return readDecimal64(literalInt(requireArg(node, 0)));
    case "Decimal128":
      return readDecimal128(literalInt(requireArg(node, 0)));
    case "Decimal256":
      return readDecimal256(literalInt(requireArg(node, 0)));
    // Auto-assigned enums arrive as a plain DataType (no explicit values); the
    // wire value is still the underlying int.
    case "Enum8":
      return readEnum8;
    case "Enum16":
      return readEnum16;

    default: {
      // Interval<Unit> (IntervalSecond, IntervalDay, …): all decode to the
      // signed Int64 count; the unit lives in the type name, not the wire.
      if (node.name.startsWith("Interval")) return readInterval;
      const leaf = NULLARY[node.name];
      if (leaf !== undefined) return leaf;
      throw new Error(`unsupported RowBinary type: ${node.name}`);
    }
  }
}

/** Folds a `Tuple(...)` — named (object) when every element is named, else positional (array). */
function tupleReader(node: Node): Reader<unknown> {
  const readers = node.arguments.map(astToReader);
  const names = node.element_names;
  const named =
    names.length === readers.length && names.every((n) => n.length > 0);
  if (named) {
    const fields: Record<string, Reader<unknown>> = {};
    for (let i = 0; i < names.length; i++) fields[names[i]!] = readers[i]!;
    return readTupleNamed(fields);
  }
  return readTuple(readers);
}

/**
 * Folds a `Variant(...)`. The 1-byte discriminant indexes the alternatives
 * sorted by type NAME (ClickHouse's global ordering), and the server writes the
 * type string with alternatives ALREADY in that sorted order — so for a
 * header-sourced type the AST argument order is the discriminant order and we
 * pass them straight through. (A hand-written, non-normalized `Variant(...)`
 * string would need sorting first.)
 */
function variantReader(node: Node): Reader<unknown> {
  return readVariant(node.arguments.map(astToReader));
}

/**
 * Folds a `Nested(name Type, …)`: on the wire it IS `Array(Tuple(...))` with
 * the field names, so we compose {@link readNested} (= `readArray(readTupleNamed)`)
 * over the `NameTypePair` children.
 */
function nestedReader(node: Node): Reader<unknown> {
  const fields: Record<string, Reader<unknown>> = {};
  for (const child of node.arguments) {
    if (child.kind !== NodeKind.NameTypePair || child.data_type === null) {
      throw new Error("malformed Nested(...): expected name/type pairs");
    }
    fields[child.name] = astToReader(child.data_type);
  }
  return readNested(fields);
}

/** Folds `Decimal(P, S)` to the right width by precision P; scale S drives decoding. */
function decimalReader(node: Node): Reader<unknown> {
  const precision = literalInt(requireArg(node, 0));
  const scale = literalInt(requireArg(node, 1));
  if (precision <= 9) return readDecimal32(scale);
  if (precision <= 18) return readDecimal64(scale);
  if (precision <= 38) return readDecimal128(scale);
  return readDecimal256(scale);
}

/** The nullary (no-argument) scalar types, mapped to their leaf readers. */
const NULLARY: Record<string, Reader<unknown>> = {
  UInt8: readUInt8,
  UInt16: readUInt16,
  UInt32: readUInt32,
  UInt64: readUInt64,
  UInt128: readUInt128,
  UInt256: readUInt256,
  Int8: readInt8,
  Int16: readInt16,
  Int32: readInt32,
  Int64: readInt64,
  Int128: readInt128,
  Int256: readInt256,
  Float32: readFloat32,
  Float64: readFloat64,
  BFloat16: readBFloat16,
  Bool: readBool,
  String: readString,
  UUID: readUUID,
  IPv4: readIPv4,
  IPv6: readIPv6,
  Date: readDate,
  Date32: readDate32,
  Time: readTime,
  Nothing: readNothing,
  // Geo types.
  Point: readPoint,
  Ring: readRing,
  LineString: readLineString,
  Polygon: readPolygon,
  MultiLineString: readMultiLineString,
  MultiPolygon: readMultiPolygon,
  Geometry: readGeometry as Reader<unknown>,
  // Self-describing types: bare `JSON` / `Dynamic` (any args are metadata).
  JSON: readJSON,
  Dynamic: readDynamic,
};

/** Argument accessor that fails loudly instead of returning `undefined`. */
function requireArg(node: Node, index: number): Node {
  const arg = node.arguments[index];
  if (arg === undefined) {
    throw new Error(`type ${node.name} is missing argument ${index}`);
  }
  return arg;
}

/** Reads an integer out of a `Literal` argument node (e.g. the N in FixedString(N)). */
function literalInt(node: Node): number {
  if (node.kind !== NodeKind.Literal) {
    throw new Error(`expected a literal argument, got a ${node.kind} node`);
  }
  return Number(node.value);
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
