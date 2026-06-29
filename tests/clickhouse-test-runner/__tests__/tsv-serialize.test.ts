import { describe, expect, it } from "vitest";
import { parseDataType } from "@clickhouse/datatype-parser";
import { formatUUID } from "@clickhouse/rowbinary/readers/uuid";
import { renderValue, compileRowRenderers } from "../src/tsv-serialize.js";

/**
 * Render a single value at top level or nested, given a ClickHouse type string.
 * The value shapes here mirror exactly what `@clickhouse/rowbinary` decodes —
 * Decimal as `[bigint, scale]`, Date/DateTime as `Date`, UUID/IPv6 as `Buffer`,
 * Map as a JS `Map`, etc. — so the test doubles as documentation of that model.
 */
function render(type: string, value: unknown, nested = false): string {
  const ast = parseDataType(type).ast!;
  return renderValue(ast, value, nested);
}

describe("renderValue — top level (escaped, unquoted)", () => {
  it("integers and bigints", () => {
    expect(render("UInt8", 255)).toBe("255");
    expect(render("Int64", -9223372036854775808n)).toBe("-9223372036854775808");
    expect(render("UInt256", 7n)).toBe("7");
  });

  it("floats incl. specials", () => {
    expect(render("Float64", 1.5)).toBe("1.5");
    expect(render("Float64", 1)).toBe("1");
    expect(render("Float64", Infinity)).toBe("inf");
    expect(render("Float64", -Infinity)).toBe("-inf");
    expect(render("Float64", NaN)).toBe("nan");
  });

  it("float64 signed zero and exponent style match ClickHouse", () => {
    expect(render("Float64", -0)).toBe("-0");
    expect(render("Float64", 0)).toBe("0");
    // positive exponents drop the '+' (1e+21 -> 1e21); negatives keep the '-'
    expect(render("Float64", 1e21)).toBe("1e21");
    expect(render("Float64", 1e-10)).toBe("1e-10");
  });

  it("float32 renders the shortest single-precision round-trip, not the widened double", () => {
    // Math.fround(0.26894) === the value ClickHouse decodes; String() of that
    // double is 0.2689400017261505, but ClickHouse prints the shortest form.
    expect(render("Float32", Math.fround(0.26894))).toBe("0.26894");
    expect(render("Float32", Math.fround(-0.76159))).toBe("-0.76159");
    expect(render("Float32", Math.fround(0.1))).toBe("0.1");
    expect(render("Float32", Math.fround(1 / 3))).toBe("0.33333334");
    expect(render("Float32", Math.fround(3.4028235e38))).toBe("3.4028235e38");
    expect(render("Float32", -0)).toBe("-0");
    expect(render("Float32", Infinity)).toBe("inf");
    expect(render("Float32", NaN)).toBe("nan");
  });

  it("bool", () => {
    expect(render("Bool", true)).toBe("true");
    expect(render("Bool", false)).toBe("false");
  });

  it("strings escape backslash, tab, newline, CR, NUL", () => {
    expect(render("String", "a\tb\nc\\d\r\0")).toBe("a\\tb\\nc\\\\d\\r\\0");
  });

  it("decimal via [unscaled, scale]", () => {
    expect(render("Decimal(10, 2)", [314n, 2])).toBe("3.14");
    expect(render("Decimal64(3)", [-1005n, 3])).toBe("-1.005");
  });

  it("date and datetime from a UTC Date", () => {
    expect(render("Date", new Date(Date.UTC(2020, 0, 2)))).toBe("2020-01-02");
    expect(render("DateTime", new Date(Date.UTC(2020, 0, 2, 3, 4, 5)))).toBe(
      "2020-01-02 03:04:05",
    );
  });

  it("datetime64 fraction scaled to precision", () => {
    // [whole-seconds Date, nanoseconds]
    const d = new Date(Date.UTC(2020, 0, 2, 3, 4, 5));
    expect(render("DateTime64(3)", [d, 500_000_000])).toBe(
      "2020-01-02 03:04:05.500",
    );
    expect(render("DateTime64(6)", [d, 123_456_000])).toBe(
      "2020-01-02 03:04:05.123456",
    );
    // Sub-precision nanoseconds are TRUNCATED, not rounded (round would give .124).
    expect(render("DateTime64(3)", [d, 123_999_999])).toBe(
      "2020-01-02 03:04:05.123",
    );
  });

  it("uuid / ipv4 / ipv6 from their decoded byte/number forms", () => {
    // readUUID hands back the raw 16 wire bytes; formatUUID applies ClickHouse's
    // byte ordering, so assert renderValue delegates to it (quoting is checked
    // in the nested suite) rather than re-deriving the layout here.
    const uuid = Buffer.from("61f0c4045cb311e7907ba6006ad3dba0", "hex");
    expect(render("UUID", uuid)).toBe(formatUUID(uuid));
    expect(render("IPv4", (1 << 24) | (2 << 16) | (3 << 8) | 4)).toBe(
      "1.2.3.4",
    );
    const ipv6 = Buffer.alloc(16);
    ipv6[15] = 1;
    expect(render("IPv6", ipv6)).toBe("::1");
  });

  it("renders the enum name the reader already resolved", () => {
    // @clickhouse/rowbinary resolves Enum8/16 to the NAME (not the wire
    // integer), so renderValue receives the name string and renders it
    // stringish: escaped + unquoted at top level, single-quoted when nested.
    expect(render("Enum8('x' = 1, 'y' = 2)", "y")).toBe("y");
    expect(render("Enum16('a' = 10, 'b' = -20)", "b")).toBe("b");
    expect(render("Enum8('x' = 1, 'y' = 2)", "y", true)).toBe("'y'");
  });

  it("NULL is backslash-N at top level", () => {
    expect(render("Nullable(Int32)", null)).toBe("\\N");
    expect(render("Nullable(Int32)", 5)).toBe("5");
  });

  it("LowCardinality is transparent", () => {
    expect(render("LowCardinality(String)", "hi")).toBe("hi");
  });
});

describe("renderValue — nested (single-quoted)", () => {
  it("stringish values gain quotes and escape the quote", () => {
    expect(render("String", "b\tc", true)).toBe("'b\\tc'");
    expect(render("String", "it's", true)).toBe("'it\\'s'");
  });

  it("numbers and decimals stay bare when nested", () => {
    expect(render("Int32", -5, true)).toBe("-5");
    expect(render("Decimal(10, 2)", [314n, 2], true)).toBe("3.14");
  });

  it("NULL is the word NULL when nested", () => {
    expect(render("Nullable(Int32)", null, true)).toBe("NULL");
  });
});

describe("renderValue — composites", () => {
  it("array brackets with nested elements", () => {
    expect(render("Array(Int32)", [1, 2, 3])).toBe("[1,2,3]");
    expect(render("Array(String)", ["a", "b\tc"])).toBe("['a','b\\tc']");
    expect(render("Array(Nullable(Int32))", [1, null, 3])).toBe("[1,NULL,3]");
    expect(render("Array(String)", [])).toBe("[]");
  });

  it("positional and named tuples both print positionally", () => {
    expect(render("Tuple(UInt8, String)", [1, "x"])).toBe("(1,'x')");
    expect(render("Tuple(a UInt8, b String)", { a: 1, b: "x" })).toBe(
      "(1,'x')",
    );
  });

  it("map prints {k:v} with quoted stringish keys/values", () => {
    const m = new Map<string, string>([
      ["k", "v"],
      ["k2", "w"],
    ]);
    expect(render("Map(String, String)", m)).toBe("{'k':'v','k2':'w'}");
  });

  it("nested composites recurse", () => {
    const m = new Map<string, number[]>([
      ["a", [1, 2]],
      ["b", [3]],
    ]);
    expect(render("Map(String, Array(UInt8))", m)).toBe("{'a':[1,2],'b':[3]}");
  });

  it("geo types render as Point tuples and their array nestings", () => {
    // shapes mirror @clickhouse/rowbinary: Point [x,y]; Ring/LineString
    // Point[]; Polygon/MultiLineString Point[][]; MultiPolygon Point[][][].
    expect(render("Point", [1.5, 2.5])).toBe("(1.5,2.5)");
    expect(
      render("Ring", [
        [0, 0],
        [1, 0],
        [1, 1],
      ]),
    ).toBe("[(0,0),(1,0),(1,1)]");
    expect(render("LineString", [[0, 0]])).toBe("[(0,0)]");
    expect(
      render("Polygon", [
        [
          [0, 0],
          [1, 0],
        ],
        [[0.1, 0.1]],
      ]),
    ).toBe("[[(0,0),(1,0)],[(0.1,0.1)]]");
    expect(
      render("MultiPolygon", [
        [
          [
            [0, 0],
            [1, 0],
          ],
        ],
      ]),
    ).toBe("[[[(0,0),(1,0)]]]");
    // geo renders identically in a nested context
    expect(render("Array(Point)", [[1.5, 2.5]])).toBe("[(1.5,2.5)]");
  });
});

describe("compileRowRenderers", () => {
  it("builds one top-level renderer per column type", () => {
    const renderers = compileRowRenderers(["UInt8", "String", "Array(Int32)"]);
    expect(renderers[0]!(7)).toBe("7");
    expect(renderers[1]!("hi")).toBe("hi");
    expect(renderers[2]!([1, 2])).toBe("[1,2]");
  });
});
