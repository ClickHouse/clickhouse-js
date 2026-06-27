/// Dependency-free unit tests (no ClickHouse binary required).
/// Run with: npm test   (vitest run)
///
/// The exhaustive server-equivalence check lives in oracle_compare.ts; these
/// pin a few representative shapes and all the deliberate rejections so `npm
/// test` is meaningful on its own.

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseDataType, toJSON } from "../src/index.js";
import { readCases } from "./cases.js";

const here = dirname(fileURLToPath(import.meta.url));

function json(typeStr: string): unknown {
  const r = parseDataType(typeStr);
  expect(r.ok(), `expected ${typeStr} to parse: ${r.error?.message}`).toBe(
    true,
  );
  return JSON.parse(toJSON(r.ast!));
}

describe("parseDataType", () => {
  it("scalar type omits the arguments slot", () => {
    expect(json("UInt8")).toEqual({ type: "DataType", name: "UInt8" });
  });

  it("nested parametric type", () => {
    expect(json("Array(Nullable(UInt64))")).toEqual({
      type: "DataType",
      name: "Array",
      arguments: [
        {
          type: "DataType",
          name: "Nullable",
          arguments: [{ type: "DataType", name: "UInt64" }],
        },
      ],
    });
  });

  it("literal arguments: 64-bit ints are JSON strings, scale is a string too", () => {
    expect(json("Decimal(10, 2)")).toEqual({
      type: "DataType",
      name: "Decimal",
      arguments: [
        { type: "Literal", value_type: "UInt64", value: "10" },
        { type: "Literal", value_type: "UInt64", value: "2" },
      ],
    });
  });

  it("explicit enum becomes EnumDataType with numeric values", () => {
    expect(json("Enum16('x' = -1, 'y' = 100)")).toEqual({
      type: "EnumDataType",
      name: "Enum16",
      values: [
        { name: "x", value: -1 },
        { name: "y", value: 100 },
      ],
    });
  });

  it("auto-assigned enum falls back to a generic DataType (not EnumDataType)", () => {
    const v = json("Enum8('a', 'b')") as { type: string };
    expect(v.type).toBe("DataType");
  });

  it("named tuple carries element_names", () => {
    expect(json("Tuple(a UInt8, b String)")).toEqual({
      type: "TupleDataType",
      name: "Tuple",
      arguments: [
        { type: "DataType", name: "UInt8" },
        { type: "DataType", name: "String" },
      ],
      element_names: ["a", "b"],
    });
  });

  it("unnamed tuple omits element_names", () => {
    const v = json("Tuple(UInt8, String)") as Record<string, unknown>;
    expect("element_names" in v).toBe(false);
  });

  it("Dynamic(max_types = 5) parses to an equals Function argument", () => {
    expect(json("Dynamic(max_types = 5)")).toEqual({
      type: "DataType",
      name: "Dynamic",
      arguments: [
        {
          type: "Function",
          name: "equals",
          is_operator: true,
          arguments: [
            { type: "Identifier", name: "max_types" },
            { type: "Literal", value_type: "UInt64", value: "5" },
          ],
        },
      ],
    });
  });

  it("SQL-standard multi-word alias", () => {
    expect(json("DOUBLE PRECISION")).toEqual({
      type: "DataType",
      name: "DOUBLE PRECISION",
    });
  });

  it("compact output has no whitespace", () => {
    const r = parseDataType("Array(String)");
    expect(r.ok()).toBe(true);
    expect(toJSON(r.ast!, -1)).toBe(
      '{"type":"DataType","name":"Array","arguments":[{"type":"DataType","name":"String"}]}',
    );
  });

  it("deliberately-unsupported types are rejected with a hard error", () => {
    for (const typeStr of readCases(join(here, "cases_unsupported.txt"))) {
      const r = parseDataType(typeStr);
      expect(r.ok(), `expected ${typeStr} to be rejected`).toBe(false);
      expect(r.error && r.error.message.length > 0).toBeTruthy();
    }
  });

  it("trailing input after a complete type is an error", () => {
    const r = parseDataType("UInt8 garbage");
    expect(r.ok()).toBe(false);
    expect(r.error!.message).toMatch(/trailing input/);
  });
});
