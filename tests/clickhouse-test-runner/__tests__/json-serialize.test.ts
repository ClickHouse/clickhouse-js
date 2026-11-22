import { describe, expect, it } from "vitest";
import { parseDataType } from "@clickhouse/datatype-parser";
import { renderJsonValue } from "../src/json-serialize.js";

/** Render a value as `ResultSet.json()` gives it for JSONCompactEachRowWithNamesAndTypes. */
function render(type: string, value: unknown, nested = false): string {
  return renderJsonValue(parseDataType(type).ast!, value, nested);
}

describe("renderJsonValue", () => {
  it("writes numbers, also quoted 64-bit integers", () => {
    expect(render("UInt8", 255)).toBe("255");
    expect(render("UInt64", "18446744073709551615")).toBe(
      "18446744073709551615",
    );
    expect(render("Float64", 1e21)).toBe("1e21");
    expect(render("Float64", -0)).toBe("-0");
    expect(render("Decimal(9, 2)", 1.2)).toBe("1.2");
  });

  it("escapes the strings that the server wrote in text form", () => {
    expect(render("String", "x'y\t")).toBe("x\\'y\\t");
    expect(render("String", "x'y", true)).toBe("'x\\'y'");
    expect(render("DateTime('Asia/Tokyo')", "2020-01-01 12:00:00")).toBe(
      "2020-01-01 12:00:00",
    );
    expect(render("Enum8('a' = 1)", "a")).toBe("a");
  });

  it("writes NULL and Bool", () => {
    expect(render("Nullable(UInt8)", null)).toBe("\\N");
    expect(render("Array(Nullable(UInt8))", [null, 1])).toBe("[NULL,1]");
    expect(render("Bool", true)).toBe("true");
  });

  it("writes arrays, named and unnamed tuples, maps and Nested", () => {
    expect(render("Array(String)", ["a", "b"])).toBe("['a','b']");
    expect(render("Tuple(UInt8, String)", [1, "a"])).toBe("(1,'a')");
    expect(render("Tuple(x UInt8, y String)", { x: 1, y: "a" })).toBe(
      "(1,'a')",
    );
    expect(render("Map(UInt8, String)", { "1": "v" })).toBe("{1:'v'}");
    expect(render("Map(String, UInt8)", { k: 1 })).toBe("{'k':1}");
    expect(render("Nested(a UInt8, b String)", [{ a: 1, b: "x" }])).toBe(
      "[(1,'x')]",
    );
  });

  it("writes geo values", () => {
    expect(render("Point", [1, 2])).toBe("(1,2)");
    expect(
      render("Ring", [
        [0, 0],
        [1, 1],
      ]),
    ).toBe("[(0,0),(1,1)]");
  });

  it("writes map keys of complex types as the server's text", () => {
    expect(render("Map(Array(UInt8), UInt8)", { "[1,2]": 4 })).toBe(
      "{[1,2]:4}",
    );
    expect(render("Map(Date, UInt8)", { "2020-01-01": 1 })).toBe(
      "{'2020-01-01':1}",
    );
  });

  it("writes an empty tuple and an Interval in a text form", () => {
    expect(render("Tuple()", [])).toBe("()");
    expect(render("Tuple(IntervalSecond)", ["00:01:12"])).toBe("('00:01:12')");
  });

  it("writes Dynamic, Variant and JSON values from the JS value", () => {
    expect(render("Dynamic", "x")).toBe("x");
    expect(render("Array(Dynamic)", ["x", 1, null])).toBe("['x',1,NULL]");
    expect(render("Variant(Array(String), UInt8)", ["a"])).toBe("['a']");
    expect(render("JSON", { a: "x/y", b: 1.5 })).toBe(
      '{"a":"x\\\\/y","b":1.5}',
    );
    expect(render("Array(JSON)", [{ a: 1 }], false)).toBe(`['{"a":1}']`);
  });

  it("throws for a type that it cannot write", () => {
    expect(() => render("Object('json')", {})).toThrow(/no TSV renderer/);
  });
});
