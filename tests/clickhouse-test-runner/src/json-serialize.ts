/**
 * Write the values that `@clickhouse/client` decodes from
 * `JSONCompactEachRowWithNamesAndTypes` (with `ResultSet.json()`) as the text
 * that ClickHouse writes for `TabSeparated`, so that the `.reference` diff of
 * tests/clickhouse-test still applies. Thus a test passes only when the client
 * gives each value as the server sent it.
 *
 * The writer is type-directed: it walks the column type (from the types row of
 * the format) together with the decoded JS value. In this format the server
 * writes dates, times, UUIDs, IPs and enums as JSON strings in their text
 * form, so the writer escapes those strings. Numbers, Bool, arrays, tuples and
 * maps need the type. Dynamic, Variant and JSON values
 * have no type in JSON: the writer writes them from the JS value. A value that
 * the writer cannot write from its type throws {@link TSVRenderError}, and the
 * statement fails.
 */

import {
  parseDataType,
  NodeKind,
  type Node,
} from "@clickhouse/datatype-parser";
import {
  TSVRenderError,
  formatFloat,
  renderStringish,
  requireArg,
} from "./tsv-serialize.js";

/** Types that the server writes as JSON strings in their text form. */
const STRING_TYPES = new Set([
  "String",
  "FixedString",
  "UUID",
  "IPv4",
  "IPv6",
  "Date",
  "Date32",
  "DateTime",
  "DateTime32",
  "DateTime64",
  "Time",
  "Time64",
  "Enum8",
  "Enum16",
  "Enum",
]);

function isIntegerType(name: string): boolean {
  return (
    /^U?Int(8|16|32|64|128|256)$/.test(name) || name.startsWith("Interval")
  );
}

function isDecimalType(name: string): boolean {
  return /^Decimal(32|64|128|256)?$/.test(name);
}

const NUMBER_TEXT = /^-?(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$|^-?(nan|inf)$/i;

/** Text of a JSON number or quoted number, as the server writes it. */
function numberText(value: unknown, node: Node, nested: boolean): string {
  if (typeof value === "string") {
    // A quoted 64-bit integer, or an Interval in a text form of
    // interval_output_format (for example kusto), which TSV quotes when nested.
    return NUMBER_TEXT.test(value) ? value : renderStringish(value, nested);
  }
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "number") {
    throw new TSVRenderError(
      `expected a number for ${node.name}, got ${typeof value}`,
    );
  }
  return formatFloat(value);
}

/** The values of a tuple, by position: a named tuple is a JSON object. */
function tupleValues(node: Node, value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const obj = value as Record<string, unknown>;
  return node.arguments.map((_, i) => {
    const name = node.element_names[i];
    if (name === undefined || name.length === 0) {
      throw new TSVRenderError("a JSON object for an unnamed tuple");
    }
    return obj[name];
  });
}

/** Render one decoded JSON value as ClickHouse TSV text. */
export function renderJsonValue(
  node: Node,
  value: unknown,
  nested: boolean,
): string {
  // A JSON value of JSON type is JSON text, also `null`; it is not SQL NULL.
  if (node.kind === NodeKind.DataType && node.name === "JSON") {
    return renderStringish(jsonText(value), nested);
  }
  if (value === null || value === undefined) return nested ? "NULL" : "\\N";

  if (node.kind === NodeKind.EnumDataType) {
    return renderStringish(String(value), nested);
  }
  if (
    node.kind === NodeKind.TupleDataType ||
    (node.kind === NodeKind.DataType &&
      node.name === "Tuple" &&
      node.arguments.length === 0)
  ) {
    const values = tupleValues(node, value);
    const cells = node.arguments.map((t, i) =>
      renderJsonValue(t, values[i], true),
    );
    return `(${cells.join(",")})`;
  }
  if (node.kind !== NodeKind.DataType) {
    throw new TSVRenderError(`cannot render a ${node.kind} node`);
  }

  const name = node.name;
  if (STRING_TYPES.has(name)) {
    if (typeof value !== "string") {
      throw new TSVRenderError(
        `expected a string for ${name}, got ${typeof value}`,
      );
    }
    return renderStringish(value, nested);
  }
  if (isIntegerType(name) || isDecimalType(name)) {
    return numberText(value, node, nested);
  }
  switch (name) {
    case "Nullable":
    case "LowCardinality":
      return renderJsonValue(requireArg(node, 0), value, nested);
    case "Float32":
    case "Float64":
    case "BFloat16":
      return numberText(value, node, nested);
    case "Bool":
      return value === true ? "true" : "false";
    case "Array":
    case "QBit": {
      const elem = requireArg(node, 0);
      return `[${(value as unknown[]).map((v) => renderJsonValue(elem, v, true)).join(",")}]`;
    }
    case "Map": {
      // The server writes a Map as a JSON object, so each key is a string.
      const keyT = requireArg(node, 0);
      const valT = requireArg(node, 1);
      const entries = Object.entries(value as Record<string, unknown>).map(
        ([k, v]) =>
          `${renderMapKey(keyT, k)}:${renderJsonValue(valT, v, true)}`,
      );
      return `{${entries.join(",")}}`;
    }
    case "Nested": {
      const rows = (value as Record<string, unknown>[]).map((row) => {
        const cells = node.arguments.map((child) => {
          if (
            child.kind !== NodeKind.NameTypePair ||
            child.data_type === null
          ) {
            throw new TSVRenderError(
              "malformed Nested(...): expected name/type pairs",
            );
          }
          return renderJsonValue(child.data_type, row[child.name], true);
        });
        return `(${cells.join(",")})`;
      });
      return `[${rows.join(",")}]`;
    }
    case "Point": {
      const [x, y] = value as [number, number];
      return `(${formatFloat(x)},${formatFloat(y)})`;
    }
    case "Dynamic":
    case "Variant":
      return renderUntyped(value, nested);
    case "MultiPoint":
    case "Ring":
    case "LineString":
    case "Polygon":
    case "MultiLineString":
    case "MultiPolygon":
    case "Geometry":
      return renderGeometry(value);
    default:
      throw new TSVRenderError(`no TSV renderer for type ${name}`);
  }
}

/**
 * A Map key arrives as a JSON object key, so it is always a string. The server
 * writes it in the text form of its type: TSV quotes only the string-like key
 * types, and writes the text of the other types (numbers, arrays, tuples) as is.
 */
function renderMapKey(keyT: Node, key: string): string {
  let t = keyT;
  while (
    t.kind === NodeKind.DataType &&
    (t.name === "LowCardinality" || t.name === "Nullable")
  ) {
    t = requireArg(t, 0);
  }
  if (
    t.kind === NodeKind.EnumDataType ||
    (t.kind === NodeKind.DataType && STRING_TYPES.has(t.name))
  ) {
    return renderStringish(key, true);
  }
  return key;
}

/**
 * A Dynamic or Variant value: JSON has no type for it, so write it from the JS
 * value. A string is quoted when nested, as the server does for its text types.
 */
function renderUntyped(value: unknown, nested: boolean): string {
  if (value === null || value === undefined) return nested ? "NULL" : "\\N";
  if (typeof value === "string") return renderStringish(value, nested);
  if (typeof value === "number") return formatFloat(value);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) {
    return `[${value.map((v) => renderUntyped(v, true)).join(",")}]`;
  }
  // An object is a JSON value inside the Dynamic (JSON or Map); write its JSON text.
  return renderStringish(jsonText(value), nested);
}

/** The JSON text of a value, with the escapes of the server (also \/). */
function jsonText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") {
    return JSON.stringify(value).replace(/\//g, "\\/");
  }
  if (typeof value === "number") return formatFloat(value);
  if (typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(jsonText).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).map(
    ([k, v]) => `${jsonText(k)}:${jsonText(v)}`,
  );
  return `{${entries.join(",")}}`;
}

/** Geo values are nested lists of `[x, y]` points; the text form is the same for all of them. */
function renderGeometry(value: unknown): string {
  const v = value as unknown[];
  if (v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number") {
    return `(${formatFloat(v[0])},${formatFloat(v[1])})`;
  }
  return `[${v.map(renderGeometry).join(",")}]`;
}

/** Parse each column type once and return a top-level writer per column. */
export function compileJsonRowRenderers(
  types: string[],
): ((value: unknown) => string)[] {
  return types.map((t) => {
    const result = parseDataType(t);
    if (!result.ok() || result.ast === null) {
      throw new TSVRenderError(
        `cannot parse column type ${JSON.stringify(t)}: ${result.error?.message ?? "unknown"}`,
      );
    }
    const node = result.ast;
    return (value: unknown) => renderJsonValue(node, value, false);
  });
}
