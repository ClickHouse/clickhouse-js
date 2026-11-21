import type { ColumnType } from "../types";
import { compareBytes, parseColumnType, quoteName } from "../types";
import { InsertValueError, ServerParseNeeded } from "./errors";

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const TWO_63 = 2 ** 63;
const TWO_64 = 2 ** 64;

const INFERRED = new Map<string, ColumnType>();
function inferred(name: string): ColumnType {
  let type = INFERRED.get(name);
  if (type === undefined) {
    // Objects with many different keys make many types: keep the cache small.
    if (INFERRED.size >= 2000) INFERRED.clear();
    type = parseColumnType(name);
    INFERRED.set(name, type);
  }
  return type;
}

/** What the client knows about a JS value in a `Dynamic` column before it
 *  makes a type name. */
type Shape =
  | { k: "null" }
  | { k: "scalar"; name: string; nullable: boolean }
  /** `inner` is `undefined` for an array without elements. */
  | { k: "array"; inner: Shape | undefined }
  /** An object. An object without keys has no fields. */
  | { k: "tuple"; fields: Map<string, Shape> }
  | { k: "dynamic" };

const NULL_SHAPE: Shape = { k: "null" };
const DYNAMIC_SHAPE: Shape = { k: "dynamic" };
const SCALARS: Record<string, Shape> = {};
function scalar(name: string): Shape {
  return (SCALARS[name] ??= { k: "scalar", name, nullable: false });
}

/** Numbers of a higher rank can hold the numbers of a lower rank. */
const NUMERIC_RANK: Record<string, number> = { Bool: 0, Int64: 1, Float64: 2 };

const NUMBER_TEXT_RE = /^[+-]?[0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?$/;

/**
 * True if the server can find a date or a date and time in the string
 * (`input_format_try_infer_dates`, `input_format_try_infer_datetimes`). The
 * rules of the server have many forms (for example `Jan 2 2024`), and the
 * client does not copy them: only a string without digits, and a string that
 * is a number, are sure to stay a `String`.
 */
function canBeDate(value: string): boolean {
  return /[0-9]/.test(value) && !NUMBER_TEXT_RE.test(value);
}

function shapeOf(value: unknown, dates: boolean): Shape {
  switch (typeof value) {
    case "string":
      if (dates && canBeDate(value)) {
        throw new ServerParseNeeded(
          `The server finds the type of the string ${JSON.stringify(value)} in a Dynamic column`,
        );
      }
      return scalar("String");
    case "boolean":
      return scalar("Bool");
    case "number":
      if (!Number.isInteger(value)) return scalar("Float64");
      if (value >= -TWO_63 && value < TWO_63) return scalar("Int64");
      if (value >= 0 && value < TWO_64) return scalar("UInt64");
      return scalar("Float64");
    case "bigint": {
      if (value >= INT64_MIN && value <= INT64_MAX) return scalar("Int64");
      if (value >= 0n && value < 1n << 64n) return scalar("UInt64");
      return scalar(value < 0n ? "Int256" : "UInt256");
    }
    case "undefined":
      return NULL_SHAPE;
    case "object": {
      if (value === null) return NULL_SHAPE;
      if (value instanceof Date) return scalar("DateTime64(3)");
      if (ArrayBuffer.isView(value)) return scalar("String");
      if (Array.isArray(value)) {
        let inner: Shape | undefined;
        for (const item of value) {
          const shape = shapeOf(item, dates);
          const merged =
            inner === undefined ? shape : mergeShapes(inner, shape);
          // The elements have no common type.
          if (merged === undefined) return { k: "array", inner: DYNAMIC_SHAPE };
          inner = merged;
        }
        return { k: "array", inner };
      }
      const fields = new Map<string, Shape>();
      for (const [key, item] of Object.entries(value)) {
        fields.set(key, shapeOf(item, dates));
      }
      return { k: "tuple", fields };
    }
    default:
      throw new InsertValueError(
        `Cannot insert a value of type ${typeof value} into a Dynamic column`,
      );
  }
}

/** The shape that holds the values of the two shapes, or `undefined` if they
 *  have no common type. */
function mergeShapes(a: Shape, b: Shape): Shape | undefined {
  if (a.k === "null") {
    return b.k === "scalar" && !b.nullable ? { ...b, nullable: true } : b;
  }
  if (b.k === "null") {
    return a.k === "scalar" && !a.nullable ? { ...a, nullable: true } : a;
  }
  if (a.k === "scalar" && b.k === "scalar") {
    const nullable = a.nullable || b.nullable;
    if (a.name === b.name) return a.nullable === nullable ? a : b;
    const rankA = NUMERIC_RANK[a.name];
    const rankB = NUMERIC_RANK[b.name];
    if (rankA === undefined || rankB === undefined) return undefined;
    return { k: "scalar", name: rankA > rankB ? a.name : b.name, nullable };
  }
  if (a.k === "array" && b.k === "array") {
    if (a.inner === undefined) return b;
    if (b.inner === undefined) return a;
    const inner = mergeShapes(a.inner, b.inner);
    return inner === undefined ? undefined : { k: "array", inner };
  }
  if (a.k === "tuple" && b.k === "tuple") {
    const fields = new Map(a.fields);
    for (const [name, shape] of b.fields) {
      const previous = fields.get(name);
      const merged =
        previous === undefined ? shape : mergeShapes(previous, shape);
      if (merged === undefined) return undefined;
      fields.set(name, merged);
    }
    return { k: "tuple", fields };
  }
  return undefined;
}

/** The name of a tuple element as the server writes it in a type name. The
 *  type names must be the names of the server, because the server sorts the
 *  types of a `Dynamic` column by name. */
function elementName(name: string): string {
  if (name === "") {
    throw new InsertValueError(
      "Cannot insert an object with an empty key into a Dynamic column",
    );
  }
  return quoteName(name);
}

function shapeTypeName(shape: Shape): string {
  switch (shape.k) {
    case "null":
      return "Nullable(String)";
    case "scalar":
      return shape.nullable ? `Nullable(${shape.name})` : shape.name;
    case "array":
      return shape.inner === undefined
        ? "Array(String)"
        : `Array(${shapeTypeName(shape.inner)})`;
    case "tuple": {
      // The server reads an object without keys as a string.
      if (shape.fields.size === 0) return "String";
      const elements: string[] = [];
      // The server sorts the keys of an object.
      const fields = [...shape.fields].sort(([a], [b]) => compareBytes(a, b));
      for (const [name, field] of fields) {
        elements.push(`${elementName(name)} ${shapeTypeName(field)}`);
      }
      return `Tuple(${elements.join(", ")})`;
    }
    case "dynamic":
      return "Dynamic";
  }
}

/**
 * The type of a JS value in a `Dynamic` column, as the server finds the type
 * of a JSON value: an object is a named `Tuple`, and the elements of an array
 * get one common type (or `Dynamic`). The client does not find dates in
 * strings: with `dates`, a string that can be a date throws
 * {@link ServerParseNeeded}.
 */
export function inferType(value: unknown, dates: boolean): ColumnType {
  return inferred(shapeTypeName(shapeOf(value, dates)));
}
