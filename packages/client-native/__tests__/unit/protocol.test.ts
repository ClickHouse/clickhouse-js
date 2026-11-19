import { describe, expect, it } from "vitest";
import {
  BinaryReader,
  BinaryWriter,
  NeedMoreData,
} from "../../src/protocol/binary";
import { readColumn, readPrefix } from "../../src/protocol/columns";
import {
  formatDate,
  formatDateTime,
  formatDateTime64,
  formatDecimal,
  formatIPv6,
  formatTime,
  formatUUID,
} from "../../src/protocol/text";
import { parseColumnType } from "../../src/protocol/types";

describe("[Native] type parser", () => {
  it("parses simple and parametric types", () => {
    expect(parseColumnType("UInt64")).toMatchObject({
      kind: "Int",
      bits: 64,
      signed: false,
    });
    expect(parseColumnType("Decimal(18, 4)")).toMatchObject({
      kind: "Decimal",
      bytes: 8,
      scale: 4,
    });
    expect(parseColumnType("Decimal128(3)")).toMatchObject({
      kind: "Decimal",
      bytes: 16,
      scale: 3,
    });
    expect(parseColumnType("DateTime64(6, 'Europe/Berlin')")).toMatchObject({
      kind: "DateTime64",
      precision: 6,
      timezone: "Europe/Berlin",
    });
    expect(parseColumnType("FixedString(16)")).toMatchObject({
      kind: "FixedString",
      size: 16,
    });
  });

  it("parses enums with quotes and negative values", () => {
    const t = parseColumnType("Enum8('a' = -1, 'it\\'s' = 2, 'x,y' = 3)");
    expect(t.kind).toBe("Enum");
    if (t.kind !== "Enum") return;
    expect([...t.values.entries()]).toEqual([
      [-1, "a"],
      [2, "it's"],
      [3, "x,y"],
    ]);
  });

  it("parses nested and named types", () => {
    const t = parseColumnType(
      "Tuple(a LowCardinality(Nullable(String)), `b c` Array(Map(String, UInt8)))",
    );
    expect(t).toMatchObject({
      kind: "Tuple",
      names: ["a", "b c"],
      elements: [
        {
          kind: "LowCardinality",
          inner: { kind: "Nullable", inner: { kind: "String" } },
        },
        { kind: "Array", inner: { kind: "Map", key: { kind: "String" } } },
      ],
    });
    expect(parseColumnType("Tuple(UInt8, String)")).toMatchObject({
      kind: "Tuple",
      names: undefined,
    });
  });

  it("parses Nested as an array of named tuples", () => {
    expect(parseColumnType("Nested(k String, v UInt32)")).toMatchObject({
      kind: "Array",
      inner: { kind: "Tuple", names: ["k", "v"] },
    });
  });

  it("parses JSON with typed paths and skip clauses", () => {
    const t = parseColumnType(
      "JSON(max_dynamic_paths = 10, b.c UInt32, `a b` String, SKIP x.y, SKIP REGEXP '^z')",
    );
    expect(t).toMatchObject({
      kind: "JSON",
      typed_paths: [
        ["a b", { kind: "String" }],
        ["b.c", { kind: "Int", bits: 32 }],
      ],
    });
  });

  it("parses SimpleAggregateFunction as its stored type", () => {
    expect(
      parseColumnType("SimpleAggregateFunction(anyLast, Nullable(String))"),
    ).toMatchObject({
      kind: "Nullable",
      name: "SimpleAggregateFunction(anyLast, Nullable(String))",
    });
  });

  it("parses geo types and intervals", () => {
    expect(parseColumnType("Point")).toMatchObject({
      kind: "Tuple",
      name: "Point",
    });
    expect(parseColumnType("IntervalSecond")).toMatchObject({
      kind: "Int",
      bits: 64,
    });
  });

  it("marks types that the client cannot decode", () => {
    expect(parseColumnType("AggregateFunction(uniq, UInt64)")).toMatchObject({
      kind: "Unsupported",
    });
  });
});

describe("[Native] binary reader", () => {
  it("reads VarUInt values", () => {
    const buf = new BinaryWriter()
      .varuint(0)
      .varuint(127)
      .varuint(128)
      .varuint(2 ** 40)
      .toBuffer();
    const r = new BinaryReader(buf);
    expect([r.varuint(), r.varuint(), r.varuint(), r.varuint()]).toEqual([
      0,
      127,
      128,
      2 ** 40,
    ]);
  });

  it("throws NeedMoreData with the needed length", () => {
    const r = new BinaryReader(Buffer.from([1, 2]));
    let err: unknown;
    try {
      r.u64();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NeedMoreData);
    expect((err as NeedMoreData).needed).toBe(8);
  });
});

describe("[Native] column decoder", () => {
  const ctx = { timezone: "UTC" };

  function decode(type: string, data: Buffer, rows: number): unknown[] {
    const t = parseColumnType(type);
    const r = new BinaryReader(data);
    const state = readPrefix(r, t);
    const values = readColumn(r, t, rows, state, ctx);
    expect(r.pos).toBe(data.length);
    return values;
  }

  it("decodes Nullable(Int32)", () => {
    const data = Buffer.alloc(2 + 8);
    data[1] = 1; // second row is NULL
    data.writeInt32LE(-5, 2);
    expect(decode("Nullable(Int32)", data, 2)).toEqual([-5, null]);
  });

  it("decodes Array(String)", () => {
    const w = new BinaryWriter()
      .u64(2)
      .u64(3)
      .string("a")
      .string("b")
      .string("c");
    expect(decode("Array(String)", w.toBuffer(), 2)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("decodes LowCardinality(Nullable(String))", () => {
    const w = new BinaryWriter()
      .u64(1) // keys version
      .u64((1 << 9) | 0) // has additional keys, UInt8 indexes
      .u64(2) // keys
      .string("") // the NULL key
      .string("x")
      .u64(3) // indexes
      .u8(1)
      .u8(0)
      .u8(1);
    expect(decode("LowCardinality(Nullable(String))", w.toBuffer(), 3)).toEqual(
      ["x", null, "x"],
    );
  });

  it("decodes Int128 and UInt256", () => {
    const i128 = Buffer.alloc(16, 0xff); // -1
    expect(decode("Int128", i128, 1)).toEqual([-1n]);
    const u256 = Buffer.alloc(32);
    u256[0] = 1;
    u256[31] = 0x80;
    expect(decode("UInt256", u256, 1)).toEqual([(1n << 255n) + 1n]);
  });
});

describe("[Native] value text", () => {
  it("formats dates and times", () => {
    expect(formatDate(0)).toBe("1970-01-01");
    expect(formatDate(-25567)).toBe("1900-01-01");
    expect(formatDateTime(0, "UTC")).toBe("1970-01-01 00:00:00");
    expect(formatDateTime(1704067200, "Asia/Kolkata")).toBe(
      "2024-01-01 05:30:00",
    );
    // Daylight saving time in Berlin starts at 2024-03-31 01:00 UTC.
    expect(formatDateTime(1711846799, "Europe/Berlin")).toBe(
      "2024-03-31 01:59:59",
    );
    expect(formatDateTime(1711846800, "Europe/Berlin")).toBe(
      "2024-03-31 03:00:00",
    );
    expect(formatDateTime64(-877n, 3, "UTC")).toBe("1969-12-31 23:59:59.123");
    expect(formatTime(-3600)).toBe("-01:00:00");
    expect(formatTime(360000)).toBe("100:00:00");
  });

  it("formats decimals", () => {
    expect(formatDecimal(15000n, 4, false)).toBe("1.5");
    expect(formatDecimal(15000n, 4, true)).toBe("1.5000");
    expect(formatDecimal(-5n, 3, false)).toBe("-0.005");
    expect(formatDecimal(0n, 2, false)).toBe("0");
    expect(formatDecimal(42n, 0, false)).toBe("42");
  });

  it("formats UUID and IPv6 values", () => {
    const uuid = Buffer.from("e711b35c04c4f061a0dbd36a00a67b90", "hex");
    expect(formatUUID(uuid, 0)).toBe("61f0c404-5cb3-11e7-907b-a6006ad3dba0");
    const ip = (s: string) => Buffer.from(s.replace(/:/g, ""), "hex");
    expect(formatIPv6(ip("00000000000000000000000000000001"), 0)).toBe("::1");
    expect(formatIPv6(ip("00000000000000000000ffff01020304"), 0)).toBe(
      "::ffff:1.2.3.4",
    );
    expect(formatIPv6(ip("20010db8000000000000000000000001"), 0)).toBe(
      "2001:db8::1",
    );
    expect(formatIPv6(ip("00010000000000010000000000000001"), 0)).toBe(
      "1:0:0:1::1",
    );
  });
});
