/// Dependency-free unit tests (no ClickHouse binary required).
/// Run with: npm test   (node --import tsx --test test/*.test.ts)
///
/// The exhaustive server-equivalence check lives in oracle_compare.ts; these
/// pin a few representative shapes and all the deliberate rejections so `npm
/// test` is meaningful on its own.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { parseDataType, toJSON } from "../src/index.js";
import { readCases } from "./cases.js";

const here = dirname(fileURLToPath(import.meta.url));

function json(typeStr: string): unknown {
  const r = parseDataType(typeStr);
  assert.ok(r.ok(), `expected ${typeStr} to parse: ${r.error?.message}`);
  return JSON.parse(toJSON(r.ast!));
}

test("scalar type omits the arguments slot", () => {
  assert.deepEqual(json("UInt8"), { type: "DataType", name: "UInt8" });
});

test("nested parametric type", () => {
  assert.deepEqual(json("Array(Nullable(UInt64))"), {
    type: "DataType",
    name: "Array",
    arguments: [
      { type: "DataType", name: "Nullable", arguments: [{ type: "DataType", name: "UInt64" }] },
    ],
  });
});

test("literal arguments: 64-bit ints are JSON strings, scale is a string too", () => {
  assert.deepEqual(json("Decimal(10, 2)"), {
    type: "DataType",
    name: "Decimal",
    arguments: [
      { type: "Literal", value_type: "UInt64", value: "10" },
      { type: "Literal", value_type: "UInt64", value: "2" },
    ],
  });
});

test("explicit enum becomes EnumDataType with numeric values", () => {
  assert.deepEqual(json("Enum16('x' = -1, 'y' = 100)"), {
    type: "EnumDataType",
    name: "Enum16",
    values: [
      { name: "x", value: -1 },
      { name: "y", value: 100 },
    ],
  });
});

test("auto-assigned enum falls back to a generic DataType (not EnumDataType)", () => {
  const v = json("Enum8('a', 'b')") as { type: string };
  assert.equal(v.type, "DataType");
});

test("named tuple carries element_names", () => {
  assert.deepEqual(json("Tuple(a UInt8, b String)"), {
    type: "TupleDataType",
    name: "Tuple",
    arguments: [
      { type: "DataType", name: "UInt8" },
      { type: "DataType", name: "String" },
    ],
    element_names: ["a", "b"],
  });
});

test("unnamed tuple omits element_names", () => {
  const v = json("Tuple(UInt8, String)") as Record<string, unknown>;
  assert.equal("element_names" in v, false);
});

test("Dynamic(max_types = 5) parses to an equals Function argument", () => {
  assert.deepEqual(json("Dynamic(max_types = 5)"), {
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

test("SQL-standard multi-word alias", () => {
  assert.deepEqual(json("DOUBLE PRECISION"), { type: "DataType", name: "DOUBLE PRECISION" });
});

test("compact output has no whitespace", () => {
  const r = parseDataType("Array(String)");
  assert.ok(r.ok());
  assert.equal(toJSON(r.ast!, -1), '{"type":"DataType","name":"Array","arguments":[{"type":"DataType","name":"String"}]}');
});

test("deliberately-unsupported types are rejected with a hard error", () => {
  for (const typeStr of readCases(join(here, "cases_unsupported.txt"))) {
    const r = parseDataType(typeStr);
    assert.equal(r.ok(), false, `expected ${typeStr} to be rejected`);
    assert.ok(r.error && r.error.message.length > 0);
  }
});

test("trailing input after a complete type is an error", () => {
  const r = parseDataType("UInt8 garbage");
  assert.equal(r.ok(), false);
  assert.match(r.error!.message, /trailing input/);
});
