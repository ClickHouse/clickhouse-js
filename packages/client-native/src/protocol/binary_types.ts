import type { BinaryReader } from "./binary";
import { ProtocolError } from "./binary";
import type { ColumnType } from "./types";
import { parseColumnType } from "./types";

/**
 * Decodes a type in the binary type encoding of the server
 * (https://clickhouse.com/docs/sql-reference/data-types/data-types-binary-encoding).
 * The `Dynamic` and `JSON` columns use it for the values that they keep in
 * their shared storage.
 */
export function readBinaryType(r: BinaryReader): ColumnType {
  return parseColumnType(readBinaryTypeName(r));
}

const SIMPLE: Record<number, string> = {
  0x00: "Nothing",
  0x01: "UInt8",
  0x02: "UInt16",
  0x03: "UInt32",
  0x04: "UInt64",
  0x05: "UInt128",
  0x06: "UInt256",
  0x07: "Int8",
  0x08: "Int16",
  0x09: "Int32",
  0x0a: "Int64",
  0x0b: "Int128",
  0x0c: "Int256",
  0x0d: "Float32",
  0x0e: "Float64",
  0x0f: "Date",
  0x10: "Date32",
  0x11: "DateTime",
  0x15: "String",
  0x1d: "UUID",
  0x28: "IPv4",
  0x29: "IPv6",
  0x2d: "Bool",
  0x31: "BFloat16",
  0x32: "Time",
};

const INTERVAL_KINDS = [
  "Nanosecond",
  "Microsecond",
  "Millisecond",
  "Second",
  "Minute",
  "Hour",
  "Day",
  "Week",
  "Month",
  "Quarter",
  "Year",
];

function quote(s: string): string {
  return "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
}

function quoteName(s: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(s)
    ? s
    : "`" + s.replace(/\\/g, "\\\\").replace(/`/g, "\\`") + "`";
}

/** Decodes a binary type into its type string. */
function readBinaryTypeName(r: BinaryReader): string {
  const code = r.u8();
  const simple = SIMPLE[code];
  if (simple !== undefined) return simple;
  switch (code) {
    case 0x12:
      return `DateTime(${quote(r.string())})`;
    case 0x13:
      return `DateTime64(${r.u8()})`;
    case 0x14: {
      const precision = r.u8();
      return `DateTime64(${precision}, ${quote(r.string())})`;
    }
    case 0x16:
      return `FixedString(${r.varuint()})`;
    case 0x17:
    case 0x18: {
      const n = r.varuint();
      const values: string[] = [];
      for (let i = 0; i < n; i++) {
        const name = r.string();
        const value =
          code === 0x17 ? r.fixed(1).readInt8(0) : r.fixed(2).readInt16LE(0);
        values.push(`${quote(name)} = ${value}`);
      }
      return `${code === 0x17 ? "Enum8" : "Enum16"}(${values.join(", ")})`;
    }
    case 0x19:
    case 0x1a:
    case 0x1b:
    case 0x1c: {
      const precision = r.u8();
      const scale = r.u8();
      return `Decimal(${precision}, ${scale})`;
    }
    case 0x1e:
      return `Array(${readBinaryTypeName(r)})`;
    case 0x1f: {
      const n = r.varuint();
      const elements: string[] = [];
      for (let i = 0; i < n; i++) elements.push(readBinaryTypeName(r));
      return `Tuple(${elements.join(", ")})`;
    }
    case 0x20: {
      const n = r.varuint();
      const elements: string[] = [];
      for (let i = 0; i < n; i++) {
        const name = r.string();
        elements.push(`${quoteName(name)} ${readBinaryTypeName(r)}`);
      }
      return `Tuple(${elements.join(", ")})`;
    }
    case 0x22: {
      const kind = INTERVAL_KINDS[r.u8()];
      if (kind === undefined) throw new ProtocolError("Unknown Interval kind");
      return `Interval${kind}`;
    }
    case 0x23:
      return `Nullable(${readBinaryTypeName(r)})`;
    case 0x26:
      return `LowCardinality(${readBinaryTypeName(r)})`;
    case 0x27: {
      const key = readBinaryTypeName(r);
      return `Map(${key}, ${readBinaryTypeName(r)})`;
    }
    case 0x2a: {
      const n = r.varuint();
      const variants: string[] = [];
      for (let i = 0; i < n; i++) variants.push(readBinaryTypeName(r));
      return `Variant(${variants.join(", ")})`;
    }
    case 0x2b:
      return `Dynamic(max_types=${r.u8()})`;
    case 0x2c:
      return r.string();
    case 0x2e: {
      // SimpleAggregateFunction: the stored type is the last argument type.
      const name = r.string();
      const params = r.varuint();
      if (params > 0) unsupportedParameters();
      const n = r.varuint();
      const args: string[] = [];
      for (let i = 0; i < n; i++) args.push(readBinaryTypeName(r));
      return `SimpleAggregateFunction(${name}, ${args.join(", ")})`;
    }
    case 0x2f: {
      const n = r.varuint();
      const elements: string[] = [];
      for (let i = 0; i < n; i++) {
        const name = r.string();
        elements.push(`${quoteName(name)} ${readBinaryTypeName(r)}`);
      }
      return `Nested(${elements.join(", ")})`;
    }
    case 0x30: {
      const version = r.u8();
      r.varuint(); // max_dynamic_paths
      r.u8(); // max_dynamic_types
      const n = r.varuint();
      const paths: string[] = [];
      for (let i = 0; i < n; i++) {
        const path = r.string();
        if (version >= 1) r.u8(); // typed path flags
        paths.push(`${quoteName(path)} ${readBinaryTypeName(r)}`);
      }
      const skip = r.varuint();
      for (let i = 0; i < skip; i++) r.string();
      const skipRegexps = r.varuint();
      for (let i = 0; i < skipRegexps; i++) r.string();
      return paths.length > 0 ? `JSON(${paths.join(", ")})` : "JSON";
    }
    case 0x34:
      return `Time64(${r.u8()})`;
    default:
      throw new ProtocolError(
        `The client cannot decode the binary type code 0x${code.toString(16)}`,
      );
  }
}

/** Aggregate function parameters use the binary Field encoding. The client
 *  does not decode it: such types are rare in `Dynamic` values. */
function unsupportedParameters(): never {
  throw new ProtocolError(
    "The client cannot decode a SimpleAggregateFunction type with parameters in a Dynamic value",
  );
}
