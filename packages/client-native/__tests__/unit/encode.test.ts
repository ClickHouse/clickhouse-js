import { describe, expect, it } from "vitest";
import { BinaryReader } from "../../src/protocol/binary";
import {
  DecimalValue,
  TypedValue,
  readColumn,
  readPrefix,
} from "../../src/protocol/columns";
import {
  InsertValueError,
  ServerParseNeeded,
  encodeBlock,
  encodeColumn,
  normalize,
  stringifyJSON,
  toScaledDecimal,
} from "../../src/protocol/encode";
import { parseColumnType } from "../../src/protocol/types";

const ctx = { timezone: "UTC" };

/** Encodes values and decodes them with the reader of the server results. */
function roundTrip(
  typeName: string,
  values: unknown[],
  timezone = "UTC",
): unknown[] {
  const type = parseColumnType(typeName);
  const normalized = values.map((v) => normalize(type, v, { timezone }));
  const { prefix, data } = encodeColumn(type, normalized);
  const buf = Buffer.concat([prefix.toBuffer(), data.toBuffer()]);
  const r = new BinaryReader(buf);
  const state = readPrefix(r, type);
  const out = readColumn(r, type, values.length, state, { timezone });
  expect(r.pos).toBe(buf.length);
  return out;
}

describe("[Native] value encoding", () => {
  it("encodes integers from numbers, bigints and strings", () => {
    expect(roundTrip("Int8", [-128, 127, "5"])).toEqual([-128, 127, 5]);
    expect(roundTrip("UInt64", [0, "18446744073709551615", 5n])).toEqual([
      0n,
      18446744073709551615n,
      5n,
    ]);
    expect(roundTrip("Int256", [-1n, "123"])).toEqual([-1n, 123n]);
  });

  it("rejects values out of range", () => {
    expect(() => normalize(parseColumnType("UInt8"), 256, ctx)).toThrow(
      InsertValueError,
    );
    expect(() => normalize(parseColumnType("Int64"), 1.5, ctx)).toThrow(
      "not an integer",
    );
    expect(() =>
      normalize(parseColumnType("UInt32"), null, {
        timezone: "UTC",
        null_as_default: false,
      }),
    ).toThrow("not Nullable");
  });

  it("checks the limits of each integer type", () => {
    const limits: Array<[string, unknown, unknown, unknown, unknown]> = [
      // type, min, max, below min, above max
      ["Int8", -128, 127, -129, 128],
      ["UInt8", 0, 255, -1, 256],
      ["Int16", -32768, 32767, -32769, 32768],
      ["UInt16", 0, 65535, -1, 65536],
      ["Int32", -2147483648, 2147483647, -2147483649, 2147483648],
      ["UInt32", 0, 4294967295, -1, 4294967296],
      [
        "Int64",
        "-9223372036854775808",
        "9223372036854775807",
        "-9223372036854775809",
        "9223372036854775808",
      ],
      ["UInt64", 0, "18446744073709551615", -1, "18446744073709551616"],
      [
        "Int128",
        -(1n << 127n),
        (1n << 127n) - 1n,
        -(1n << 127n) - 1n,
        1n << 127n,
      ],
      ["UInt256", 0n, (1n << 256n) - 1n, -1n, 1n << 256n],
    ];
    for (const [name, min, max, below, above] of limits) {
      const type = parseColumnType(name);
      expect(String(normalize(type, min, ctx))).toBe(String(min));
      expect(String(normalize(type, max, ctx))).toBe(String(max));
      expect(() => normalize(type, below, ctx), `${name} ${below}`).toThrow(
        "out of range",
      );
      expect(() => normalize(type, above, ctx), `${name} ${above}`).toThrow(
        "out of range",
      );
    }
    expect(() => normalize(parseColumnType("Int32"), NaN, ctx)).toThrow(
      InsertValueError,
    );
    expect(() => normalize(parseColumnType("UInt8"), "x", ctx)).toThrow(
      InsertValueError,
    );
  });

  it("encodes decimals exactly", () => {
    const t = parseColumnType("Decimal(18, 4)");
    expect(toScaledDecimal(t, "1.23456", 4)).toBe(12345n);
    expect(toScaledDecimal(t, "-0.5", 4)).toBe(-5000n);
    expect(toScaledDecimal(t, 1e-3, 4)).toBe(10n);
    expect(toScaledDecimal(t, "1.5e2", 4)).toBe(1500000n);
    expect(roundTrip("Decimal(9, 2)", ["1.5", 2, -0.01])).toEqual([
      new DecimalValue(150n, 2),
      new DecimalValue(200n, 2),
      new DecimalValue(-1n, 2),
    ]);
  });

  it("reads decimal text with and without the fast path", () => {
    const t = parseColumnType("Decimal(38, 2)");
    expect(toScaledDecimal(t, "1.239", 2)).toBe(123n);
    expect(toScaledDecimal(t, "-1.239", 2)).toBe(-123n);
    expect(toScaledDecimal(t, "+5", 2)).toBe(500n);
    expect(toScaledDecimal(t, ".5", 2)).toBe(50n);
    expect(toScaledDecimal(t, "5.", 2)).toBe(500n);
    expect(toScaledDecimal(t, " 7 ", 2)).toBe(700n);
    expect(toScaledDecimal(t, 0.1 + 0.2, 2)).toBe(30n);
    expect(toScaledDecimal(t, 1e21, 2)).toBe(10n ** 23n);
    expect(toScaledDecimal(t, 5n, 2)).toBe(500n);
    // More digits than the fast path takes.
    expect(toScaledDecimal(t, "12345678901234567890.129", 2)).toBe(
      1234567890123456789012n,
    );
    expect(toScaledDecimal(t, "-0", 2)).toBe(0n);
    for (const bad of ["", "abc", "1.2.3", "-", ".", "1e", NaN, Infinity, {}]) {
      expect(() => toScaledDecimal(t, bad, 2), String(bad)).toThrow(
        InsertValueError,
      );
    }
    const d9 = parseColumnType("Decimal(9, 2)");
    expect(normalize(d9, "21474836.47", ctx)).toBe(2147483647n);
    expect(() => normalize(d9, "21474836.48", ctx)).toThrow("out of range");
    expect(() => normalize(d9, "-21474836.49", ctx)).toThrow("out of range");
  });

  it("encodes dates and times in the time zone of the column", () => {
    expect(
      roundTrip("Date", ["2024-02-29", new Date(Date.UTC(2020, 0, 2))]),
    ).toEqual(["2024-02-29", "2020-01-02"]);
    expect(
      roundTrip("DateTime('Europe/Berlin')", [
        "2024-03-31 03:30:00",
        new Date(Date.UTC(2024, 0, 1)),
        0,
        "2024-01-01T12:00:00Z",
      ]),
    ).toEqual([
      "2024-03-31 03:30:00",
      "2024-01-01 01:00:00",
      "1970-01-01 01:00:00",
      "2024-01-01 13:00:00",
    ]);
    expect(
      roundTrip("DateTime64(3)", [
        "2024-01-01 00:00:00.5",
        1700000000.25,
        new Date(1),
      ]),
    ).toEqual([
      "2024-01-01 00:00:00.500",
      "2023-11-14 22:13:20.250",
      "1970-01-01 00:00:00.001",
    ]);
    expect(roundTrip("Time64(3)", ["-01:02:03.5", "100:00:00"])).toEqual([
      "-01:02:03.500",
      "100:00:00.000",
    ]);
  });

  /** Expects an InsertValueError that names the value and the type. */
  function expectRejected(typeName: string, values: unknown[]): void {
    const type = parseColumnType(typeName);
    for (const value of values) {
      let error: unknown;
      try {
        normalize(type, value, ctx);
      } catch (err) {
        error = err;
      }
      const label = `${typeName} <- ${String(value)}`;
      expect(error, label).toBeInstanceOf(InsertValueError);
      expect((error as Error).message, label).toContain(
        `into a column of type ${type.name}`,
      );
      expect((error as Error).message, label).toContain(
        "Cannot insert the value",
      );
    }
  }

  it("changes DateTime values out of range to the nearest limit", () => {
    expect(
      roundTrip("DateTime('UTC')", [
        -1,
        0,
        4294967295,
        4294967296,
        5000000000,
        1.9,
        -1.5,
        -5n,
        1n << 40n,
        new Date(-1000),
        "1960-01-01 00:00:00",
        "1970-01-01 00:00:00",
        "2106-02-07 06:28:15",
        "2106-02-07 06:28:16",
        "9999-12-31 23:59:59",
      ]),
    ).toEqual([
      "1970-01-01 00:00:00",
      "1970-01-01 00:00:00",
      "2106-02-07 06:28:15",
      "2106-02-07 06:28:15",
      "2106-02-07 06:28:15",
      "1970-01-01 00:00:01",
      "1970-01-01 00:00:00",
      "1970-01-01 00:00:00",
      "2106-02-07 06:28:15",
      "1970-01-01 00:00:00",
      "1970-01-01 00:00:00",
      "1970-01-01 00:00:00",
      "2106-02-07 06:28:15",
      "2106-02-07 06:28:15",
      "2106-02-07 06:28:15",
    ]);
    // The limits are UTC times: in Berlin the first second is 01:00:00.
    expect(
      roundTrip("DateTime('Europe/Berlin')", [
        "1970-01-01 00:00:00",
        "1970-01-01 01:00:00",
        "2106-02-07 07:28:16",
      ]),
    ).toEqual([
      "1970-01-01 01:00:00",
      "1970-01-01 01:00:00",
      "2106-02-07 07:28:15",
    ]);
  });

  it("reads the text forms of DateTime that the server reads", () => {
    expect(
      roundTrip("DateTime('UTC')", [
        "1700000000",
        "170000000",
        "1700000000123",
        "20240101",
        "202401",
        "20240101101010",
        "20240101101010.5",
        "2024-01-01",
        "2024-1-5 1:02:03",
        "2024-01-01 10:00",
        "2024-01-01 10:00:00.5",
        "2024-01-01T10:00:00+02:00",
        "2024-01-01 10:00:00 +0200",
        " 2024-01-01 10:00:00",
        "2024-01-01 25:00:00",
        "2024-01-01 10:60:00",
        "2024-02-29 00:00:00",
      ]),
    ).toEqual([
      "2023-11-14 22:13:20",
      "1975-05-22 14:13:20",
      "2023-11-14 22:13:20",
      "2024-01-01 00:00:00",
      "2024-01-01 00:00:00",
      "2024-01-01 10:10:10",
      "2024-01-01 10:10:10",
      "2024-01-01 00:00:00",
      "2024-01-05 01:02:03",
      "2024-01-01 10:00:00",
      "2024-01-01 10:00:00",
      "2024-01-01 08:00:00",
      "2024-01-01 08:00:00",
      "2024-01-01 10:00:00",
      "2024-01-02 01:00:00",
      "2024-01-01 11:00:00",
      "2024-02-29 00:00:00",
    ]);
    expect(roundTrip("DateTime('Europe/Berlin')", ["20240701"])).toEqual([
      "2024-07-01 00:00:00",
    ]);
    expectRejected("DateTime('UTC')", [
      NaN,
      Infinity,
      true,
      "",
      "abc",
      "nan",
      "-1",
      "1",
      "1.5",
      "12345",
      "1234567",
      "17000000000",
      "202401011010",
      "1700000000.7",
      "202413",
      "20241301",
      "2024-13-01 00:00:00",
      "2024-01-32 00:00:00",
      "2024-02-30 00:00:00",
      "2023-02-29 00:00:00",
      "0000-00-00 00:00:00",
      {},
    ]);
  });

  it("changes Date values out of range to the nearest limit", () => {
    const date = parseColumnType("Date");
    const days = (values: unknown[]) =>
      values.map((v) => normalize(date, v, ctx));
    expect(
      days([-1, 0, 65535, 65536, 86400, 1700000000, 4294967296, 1e15]),
    ).toEqual([0, 0, 65535, 0, 1, 19675, 49710, 49710]);
    expect(days([true, false, 5n, new Date(Date.UTC(1960, 0, 1))])).toEqual([
      1, 0, 5, 0,
    ]);
    expect(
      days([
        "1960-01-01",
        "0001-01-01",
        "1970-01-01",
        "2149-06-06",
        "2149-06-07",
        "9999-12-31",
        "20240101",
        "2024-1-5",
        "2024/01/01",
        "2024-02-30",
      ]),
    ).toEqual([0, 0, 0, 65535, 65535, 65535, 19723, 19727, 19723, 19783]);
    // The server stores 1970-01-01 for a month or a day that is not correct.
    expect(
      days([
        "2024-13-01",
        "2024-00-10",
        "2024-01-00",
        "2024-01-32",
        "20241301",
      ]),
    ).toEqual([0, 0, 0, 0, 0]);
    // A number above the largest day is UNIX seconds in the time zone.
    expect(
      normalize(date, 1704063600, { timezone: "Europe/Berlin" }), // 2023-12-31 23:00 UTC
    ).toBe(19723);
    expect(roundTrip("Date", ["1960-01-01", 100000, "2300-01-01"])).toEqual([
      "1970-01-01",
      "1970-01-02",
      "2149-06-06",
    ]);
    expectRejected("Date", [
      1.5,
      NaN,
      Infinity,
      "",
      "abc",
      "19000",
      "-5",
      "202401",
      " 2024-01-01",
      "2024-01-01 ",
      "2024-01-01 10:00:00",
      "2024-01-01T00:00:00",
      {},
    ]);
  });

  it("changes Date32 values out of range to the nearest limit", () => {
    const date32 = parseColumnType("Date32");
    const days = (values: unknown[]) =>
      values.map((v) => normalize(date32, v, ctx));
    expect(
      days([
        -719528, -719529, -2147483649, -1, 120530, 2932896, 2932897, 1700000000,
        2147483647, 2147483648,
      ]),
    ).toEqual([
      -719528, -719528, -719528, -1, 120530, 2932896, 33, 19675, 24855, 24855,
    ]);
    expect(
      days([
        "0001-01-01",
        "1899-12-31",
        "9999-12-31",
        "20240101",
        "2024-02-30",
      ]),
    ).toEqual([-719162, -25568, 2932896, 19723, 19783]);
    // The server stores 1900-01-01 for a month or a day that is not correct.
    expect(days(["0000-00-00", "2024-13-01", "2024-01-32"])).toEqual([
      -25567, -25567, -25567,
    ]);
    expect(roundTrip("Date32", ["1900-01-01", "2299-12-31", -25568])).toEqual([
      "1900-01-01",
      "2299-12-31",
      "1899-12-31",
    ]);
    expectRejected("Date32", [1.5, NaN, "19000", "-5", "2024-01-01 10:00:00"]);
  });

  it("keeps all digits of DateTime64 values", () => {
    const ticks = (typeName: string, value: unknown) =>
      normalize(parseColumnType(typeName), value, ctx);
    const seconds = (year: number) => BigInt(Date.UTC(year, 0, 1) / 1000);
    // Above 2^53 ticks.
    expect(ticks("DateTime64(6, 'UTC')", "2262-01-01 00:00:00.123457")).toBe(
      seconds(2262) * 1000000n + 123457n,
    );
    expect(ticks("DateTime64(6, 'UTC')", "2299-12-31 23:59:59.999999")).toBe(
      seconds(2300) * 1000000n - 1n,
    );
    expect(ticks("DateTime64(6, 'UTC')", "9999-12-31 23:59:59.999999")).toBe(
      253402300799999999n,
    );
    expect(ticks("DateTime64(9, 'UTC')", "2262-04-11 23:47:16.854775807")).toBe(
      (1n << 63n) - 1n,
    );
    expect(ticks("DateTime64(3, 'UTC')", "1969-12-31 23:59:59.5")).toBe(-500n);
    expect(ticks("DateTime64(3, 'UTC')", "0001-01-01 00:00:00")).toBe(
      -62135596800000n,
    );
    expect(ticks("DateTime64(3, 'UTC')", "2024-01-01 10:00:00.1234567")).toBe(
      1704103200123n,
    );
    expect(ticks("DateTime64(0, 'UTC')", "2024-01-01 10:00:00.9")).toBe(
      1704103200n,
    );
    expect(() =>
      ticks("DateTime64(9, 'UTC')", "2262-04-11 23:47:16.854775808"),
    ).toThrow("out of range");
    expect(() => ticks("DateTime64(9, 'UTC')", "1600-01-01 00:00:00")).toThrow(
      "out of range",
    );
    // The server needs the whole seconds to fit 64 bits also without the fraction.
    expect(() =>
      ticks("DateTime64(9, 'UTC')", "1677-09-21 00:12:43.145224193"),
    ).toThrow("out of range");
  });

  it("reads numeric text for DateTime64 by its count of digits", () => {
    const ticks = (typeName: string, value: unknown) =>
      normalize(parseColumnType(typeName), value, ctx);
    expect(ticks("DateTime64(3, 'UTC')", "1700000000123")).toBe(1700000000123n);
    expect(ticks("DateTime64(6, 'UTC')", "1700000000123")).toBe(
      1700000000123000n,
    );
    expect(ticks("DateTime64(3, 'UTC')", "1700000000123456")).toBe(
      1700000000123n,
    );
    expect(ticks("DateTime64(9, 'UTC')", "1700000000123456789")).toBe(
      1700000000123456789n,
    );
    expect(ticks("DateTime64(3, 'UTC')", "1700000000")).toBe(1700000000000n);
    expect(ticks("DateTime64(3, 'UTC')", "170000000.5")).toBe(170000000500n);
    expect(ticks("DateTime64(3, 'UTC')", "1700000000.12345")).toBe(
      1700000000123n,
    );
    expect(ticks("DateTime64(3, 'UTC')", "20240101")).toBe(1704067200000n);
    expect(ticks("DateTime64(3, 'UTC')", "20240101101010.5")).toBe(
      1704103810500n,
    );
    expectRejected("DateTime64(3, 'UTC')", [
      "-0.5",
      "0.5",
      "-1",
      "1",
      "12345",
      "99999999999",
      "1700000000123.5",
      "20240101.5",
      "202401011010",
      "2024-13-01 00:00:00",
      "2024-02-30 00:00:00",
      "10000-01-01 00:00:00",
      "abc",
      true,
      NaN,
    ]);
  });

  it("reads a number for DateTime64 as seconds, within the years 0000-9999", () => {
    const t3 = parseColumnType("DateTime64(3, 'UTC')");
    const ticks = (value: unknown) => normalize(t3, value, ctx);
    expect(ticks(-0.5)).toBe(-500n);
    expect(ticks(1.9999)).toBe(1999n);
    expect(ticks(-1.9999)).toBe(-1999n);
    expect(ticks(1700000000)).toBe(1700000000000n);
    expect(ticks(5n)).toBe(5000n);
    expect(ticks(253402300799.5)).toBe(253402300799500n);
    expect(ticks(253402300800)).toBe(253402300799000n);
    expect(ticks(1e15)).toBe(253402300799000n);
    expect(ticks(-62167219200.5)).toBe(-62167219200500n);
    expect(ticks(-62167219201)).toBe(-62167219200000n);
    expect(ticks(-1e12)).toBe(-62167219200000n);
    expect(ticks(new Date(1))).toBe(1n);
    expect(() => ticks(1e300)).toThrow("out of range");
    const t9 = parseColumnType("DateTime64(9, 'UTC')");
    expect(normalize(t9, 9223372036, ctx)).toBe(9223372036000000000n);
    expect(normalize(t9, -9223372036, ctx)).toBe(-9223372036000000000n);
    expect(normalize(t9, 1.5, ctx)).toBe(1500000000n);
    expect(() => normalize(t9, 9223372037, ctx)).toThrow("out of range");
    expect(() => normalize(t9, -9223372037, ctx)).toThrow("out of range");
    const t0 = parseColumnType("DateTime64(0, 'UTC')");
    expect(normalize(t0, new Date(-1), ctx)).toBe(-1n);
  });

  it("reads Time text as the server does", () => {
    const time = parseColumnType("Time");
    const seconds = (values: unknown[]) =>
      values.map((v) => normalize(time, v, ctx));
    expect(
      seconds([
        "1:02",
        "01:02",
        "99:59",
        "1:60",
        "-0:01",
        "1:02:03",
        "001:02:03",
        "100:00:00",
        "-999:59:59",
        "999:59:60",
        "62",
        "5",
        "-62",
      ]),
    ).toEqual([
      62, 62, 5999, 120, -1, 3723, 3723, 360000, -3599999, 3599999, 62, 5, -62,
    ]);
    expect(seconds([62, -5, 5n, 3599999, 3600000, -4000000, 1e10])).toEqual([
      62, -5, 5, 3599999, 3599999, -3599999, 3599999,
    ]);
    expectRejected("Time", [
      "123",
      "1:2:3",
      "12:3",
      "100:00",
      "1000:00:00",
      "1:02:03.5",
      "5.",
      "+1:02",
      " 1:02",
      "",
      "abc",
      1.5,
      NaN,
      true,
    ]);
  });

  it("reads Time64 text as seconds and a Time64 number as ticks", () => {
    const time = parseColumnType("Time64(3)");
    const ticks = (values: unknown[]) =>
      values.map((v) => normalize(time, v, ctx));
    expect(
      ticks([
        "1:02",
        "1:02.5",
        "01:02:03.5",
        "1:02:03.1239",
        "1:02:03.",
        "-01:02:03.500",
        "62",
        "62.5",
        "-62.5",
        "0.5",
        "1.2345",
        "999:59:59.9999",
      ]),
    ).toEqual([
      62000n,
      62500n,
      3723500n,
      3723123n,
      3723000n,
      -3723500n,
      62000n,
      62500n,
      -62500n,
      500n,
      1234n,
      3599999999n,
    ]);
    // A number is a count of ticks. The server keeps the fraction of the
    // last second only.
    expect(
      ticks([
        62,
        -62,
        5n,
        3599999999,
        3600000000,
        -3599999999,
        -3600000000,
        1e15,
      ]),
    ).toEqual([
      62n,
      -62n,
      5n,
      3599999999n,
      3599999000n,
      -3599999999n,
      -3599999000n,
      3599999000n,
    ]);
    expectRejected("Time64(3)", [".5", "123", "1:2:3", "100:00.5", 1.5, true]);
  });

  it("gives the default value for null when the type is not Nullable", () => {
    expect(roundTrip("UInt8", [null, 1])).toEqual([0, 1]);
    expect(roundTrip("Int64", [null])).toEqual([0n]);
    expect(roundTrip("String", [null])).toEqual([""]);
    expect(roundTrip("FixedString(2)", [null])).toEqual(["\0\0"]);
    expect(roundTrip("Bool", [null])).toEqual([false]);
    expect(roundTrip("Date", [null])).toEqual(["1970-01-01"]);
    expect(roundTrip("DateTime64(3, 'UTC')", [null])).toEqual([
      "1970-01-01 00:00:00.000",
    ]);
    expect(roundTrip("UUID", [null])).toEqual([
      "00000000-0000-0000-0000-000000000000",
    ]);
    expect(roundTrip("IPv6", [null])).toEqual(["::"]);
    expect(roundTrip("Decimal(9, 2)", [null])).toEqual([
      new DecimalValue(0n, 2),
    ]);
    expect(roundTrip("LowCardinality(String)", [null, "a"])).toEqual(["", "a"]);
    // The default of an Enum is the element with the smallest value.
    expect(roundTrip("Enum8('c' = 1, 'a' = -1, 'b' = 0)", [null])).toEqual([
      "a",
    ]);
    expect(roundTrip("Enum8('x' = 5, 'b' = 2)", [null])).toEqual(["b"]);
    expect(roundTrip("Array(Int32)", [[1, null, 3], null])).toEqual([
      [1, 0, 3],
      [],
    ]);
    expect(roundTrip("Array(Array(String))", [[null, ["a", null]]])).toEqual([
      [[], ["a", ""]],
    ]);
    expect(roundTrip("Map(String, Int32)", [{ a: null }, null])).toEqual([
      [["a", 0]],
      [],
    ]);
    expect(
      roundTrip("Tuple(a Int32, b String)", [{ a: null, b: "x" }, null]),
    ).toEqual([
      [0, "x"],
      [0, ""],
    ]);
    expect(
      roundTrip("Array(Tuple(a Int32, b Nullable(String)))", [
        [{ a: null, b: null }, null],
      ]),
    ).toEqual([
      [
        [0, null],
        [0, null],
      ],
    ]);
    expect(normalize(parseColumnType("JSON"), null, ctx)).toBe("{}");
    // undefined is the same as null.
    expect(roundTrip("UInt8", [undefined])).toEqual([0]);
  });

  it("rejects null for a type that is not Nullable when null_as_default is false", () => {
    const strict = { timezone: "UTC", null_as_default: false };
    const cases: Array<[string, unknown]> = [
      ["UInt8", null],
      ["String", null],
      ["Array(Int32)", null],
      ["Array(Int32)", [1, null]],
      ["Map(String, Int32)", { a: null }],
      ["Tuple(a Int32, b String)", { a: null, b: "x" }],
      ["LowCardinality(String)", null],
      ["JSON", null],
    ];
    for (const [typeName, value] of cases) {
      expect(
        () => normalize(parseColumnType(typeName), value, strict),
        typeName,
      ).toThrow("the column is not Nullable");
    }
    // The types that hold null themselves do not use the setting.
    for (const typeName of [
      "Nullable(Int32)",
      "LowCardinality(Nullable(String))",
      "Variant(String, UInt8)",
      "Dynamic",
    ]) {
      expect(normalize(parseColumnType(typeName), null, strict)).toBeNull();
    }
    expect(
      normalize(parseColumnType("Array(Nullable(Int32))"), [null], strict),
    ).toEqual([null]);
    // A missing element of a tuple gets the default value in the two modes.
    expect(
      normalize(
        parseColumnType("Tuple(a Int32, b String)"),
        { b: "x" },
        strict,
      ),
    ).toEqual([0, Buffer.from("x")]);
  });

  it("encodes UUID and IP values", () => {
    expect(roundTrip("UUID", ["61f0c404-5cb3-11e7-907b-a6006ad3dba0"])).toEqual(
      ["61f0c404-5cb3-11e7-907b-a6006ad3dba0"],
    );
    expect(roundTrip("IPv4", ["10.0.0.1", 0])).toEqual(["10.0.0.1", "0.0.0.0"]);
    const ips = [
      "::",
      "::1",
      "2001:db8::1",
      "::ffff:1.2.3.4",
      "1:0:0:1::1",
      "fe80::1:2",
      "1:2:3:4:5:6:7:8",
    ];
    expect(roundTrip("IPv6", ips)).toEqual(ips);
    expect(roundTrip("IPv6", ["1.2.3.4"])).toEqual(["::ffff:1.2.3.4"]);
  });

  it("encodes strings, enums and booleans", () => {
    expect(roundTrip("String", ["a", "", "Привет", 5, { a: 1 }])).toEqual([
      "a",
      "",
      "Привет",
      "5",
      '{"a":1}',
    ]);
    expect(roundTrip("FixedString(3)", ["ab"])).toEqual(["ab\0"]);
    expect(roundTrip("Enum8('a' = 1, 'b' = -2)", ["b", 1])).toEqual(["b", "a"]);
    expect(roundTrip("Bool", [true, 0, "true"])).toEqual([true, false, true]);
  });

  it("encodes nested types", () => {
    expect(roundTrip("Array(Nullable(String))", [["a", null], []])).toEqual([
      ["a", null],
      [],
    ]);
    expect(
      roundTrip("Map(String, Array(UInt8))", [
        { k: [1] },
        new Map([["x", []]]),
      ]),
    ).toEqual([[["k", [1]]], [["x", []]]]);
    expect(
      roundTrip("Tuple(a UInt8, b Nullable(String))", [
        { a: 1, b: null },
        [2, "x"],
        { a: 3 },
      ]),
    ).toEqual([
      [1, null],
      [2, "x"],
      [3, null],
    ]);
    expect(
      roundTrip("Nested(k String, v UInt8)", [[{ k: "a", v: 1 }]]),
    ).toEqual([[["a", 1]]]);
  });

  it("encodes LowCardinality columns", () => {
    expect(roundTrip("LowCardinality(String)", ["a", "b", "a"])).toEqual([
      "a",
      "b",
      "a",
    ]);
    expect(
      roundTrip("LowCardinality(Nullable(String))", ["a", null, "a", ""]),
    ).toEqual(["a", null, "a", ""]);
    const many = Array.from({ length: 1000 }, (_, i) => String(i % 300));
    expect(roundTrip("LowCardinality(String)", many)).toEqual(many);
  });

  it("chooses the variant for each value", () => {
    const out = roundTrip("Variant(Array(UInt8), String, UInt64)", [
      1,
      "x",
      [2],
      null,
    ]);
    expect(
      out.map((v) => (v instanceof TypedValue ? [v.type.name, v.value] : v)),
    ).toEqual([["UInt64", 1n], ["String", "x"], ["Array(UInt8)", [2]], null]);
  });

  it("infers the types of Dynamic values as the server does for JSON", () => {
    const dynamic = parseColumnType("Dynamic");
    const typeOf = (value: unknown) =>
      (normalize(dynamic, value, ctx) as { t: { name: string } }).t.name;
    expect(typeOf({ a: 1 })).toBe("Tuple(a Int64)");
    expect(typeOf({ a: { b: "x" }, c: [1, 2] })).toBe(
      "Tuple(a Tuple(b String), c Array(Int64))",
    );
    expect(typeOf({ a: null })).toBe("Tuple(a Nullable(String))");
    expect(typeOf({ a: [] })).toBe("Tuple(a Array(String))");
    expect(typeOf({ a: {} })).toBe("Tuple(a String)");
    expect(typeOf({ a: [1, "x"] })).toBe("Tuple(a Array(Dynamic))");
    expect(typeOf({ "a b": 1, "a.b": 2 })).toBe(
      "Tuple(`a b` Int64, `a.b` Int64)",
    );
    expect(typeOf({ "`q`": 1 })).toBe("Tuple(`\\`q\\`` Int64)");
    expect(typeOf({})).toBe("String");
    expect(typeOf([])).toBe("Array(String)");
    expect(typeOf([null])).toBe("Array(Nullable(String))");
    expect(typeOf([1, null])).toBe("Array(Nullable(Int64))");
    expect(typeOf([true, null])).toBe("Array(Nullable(Bool))");
    expect(typeOf([1, 2.5])).toBe("Array(Float64)");
    expect(typeOf([true, 1])).toBe("Array(Int64)");
    expect(typeOf([1, true, 2.5])).toBe("Array(Float64)");
    expect(typeOf([1, "a"])).toBe("Array(Dynamic)");
    expect(typeOf([[1], ["a"]])).toBe("Array(Dynamic)");
    expect(typeOf([[1], null])).toBe("Array(Array(Int64))");
    expect(typeOf([[], [1]])).toBe("Array(Array(Int64))");
    expect(typeOf([[1, 2], [1.5]])).toBe("Array(Array(Float64))");
    expect(typeOf([{ a: 1 }])).toBe("Array(Tuple(a Int64))");
    expect(typeOf([{ a: 1 }, { b: "x" }])).toBe(
      "Array(Tuple(a Int64, b String))",
    );
    expect(typeOf([{ a: 1 }, null])).toBe("Array(Tuple(a Int64))");
    expect(typeOf([{}, { a: 1 }])).toBe("Array(Tuple(a Int64))");
    expect(typeOf([{ a: null }, { a: 1 }])).toBe(
      "Array(Tuple(a Nullable(Int64)))",
    );
    expect(typeOf([{ a: { x: 1 } }, { a: { y: "s" } }])).toBe(
      "Array(Tuple(a Tuple(x Int64, y String)))",
    );
    expect(typeOf([{ a: 1 }, { a: "x" }])).toBe("Array(Dynamic)");
    expect(typeOf(2 ** 63)).toBe("UInt64");
    expect(typeOf(1e100)).toBe("Float64");
    expect(typeOf(1n << 64n)).toBe("UInt256");
    expect(typeOf(new Date(0))).toBe("DateTime64(3)");
    expect(typeOf(Buffer.from("x"))).toBe("String");
    expect(() => typeOf({ "": 1 })).toThrow(InsertValueError);

    const out = roundTrip("Dynamic", [
      { a: 1, b: "x" },
      [{ a: 1 }, { b: "y" }, null],
      {},
    ]);
    expect(
      out.map((v) => (v instanceof TypedValue ? [v.type.name, v.value] : v)),
    ).toEqual([
      ["Tuple(a Int64, b String)", [1n, "x"]],
      [
        "Array(Tuple(a Int64, b String))",
        [
          [1n, ""],
          [0n, "y"],
          [0n, ""],
        ],
      ],
      ["String", "{}"],
    ]);
  });

  it("writes a bigint as a JSON number", () => {
    expect(stringifyJSON({ big: 12345678901234567890n, n: [1n] })).toBe(
      '{"big":12345678901234567890,"n":[1]}',
    );
    expect(
      normalize(parseColumnType("JSON"), { big: 12345678901234567890n }, ctx),
    ).toBe('{"big":12345678901234567890}');
    expect(roundTrip("String", [{ a: 1n }])).toEqual(['{"a":1}']);
  });

  it("writes a block of columns", () => {
    const u8 = parseColumnType("UInt8");
    const str = parseColumnType("String");
    const block = encodeBlock(
      [
        { name: "a", type: u8, values: [1, 2] },
        {
          name: "s",
          type: str,
          values: ["x", "yz"].map((v) => normalize(str, v, ctx)),
        },
      ],
      2,
      true,
    );
    expect(block).toEqual(
      Buffer.concat([
        Buffer.from([1, 0, 2, 0xff, 0xff, 0xff, 0xff, 0]), // block info
        Buffer.from([2, 2]), // columns, rows
        Buffer.from("\x01a\x05UInt8\x00", "latin1"),
        Buffer.from([1, 2]),
        Buffer.from("\x01s\x06String\x00", "latin1"),
        Buffer.from("\x01x\x02yz", "latin1"),
      ]),
    );
    // Without the custom serialization flag (older servers).
    expect(
      encodeBlock([{ name: "a", type: u8, values: [7] }], 1, false),
    ).toEqual(
      Buffer.concat([
        Buffer.from([1, 0, 2, 0xff, 0xff, 0xff, 0xff, 0, 1, 1]),
        Buffer.from("\x01a\x05UInt8", "latin1"),
        Buffer.from([7]),
      ]),
    );
  });

  it("encodes large columns of each layout", () => {
    const n = 70_000;
    const strings = Array.from(
      { length: n },
      (_, i) => "v" + "x".repeat(i % 50),
    );
    expect(roundTrip("String", strings)).toEqual(strings);
    const numbers = Array.from({ length: n }, (_, i) => i - 1000);
    expect(roundTrip("Int32", numbers)).toEqual(numbers);
    expect(roundTrip("Int64", numbers)).toEqual(numbers.map(BigInt));
    expect(roundTrip("Int8", [-128, -1, 0, 127])).toEqual([-128, -1, 0, 127]);
    expect(roundTrip("Int16", [-32768, -1, 32767])).toEqual([
      -32768, -1, 32767,
    ]);
    expect(roundTrip("UInt16", [0, 65535])).toEqual([0, 65535]);
    expect(roundTrip("UInt64", ["18446744073709551615", 0])).toEqual([
      18446744073709551615n,
      0n,
    ]);
    expect(roundTrip("Int128", [-(1n << 127n), (1n << 127n) - 1n])).toEqual([
      -(1n << 127n),
      (1n << 127n) - 1n,
    ]);
    expect(roundTrip("Float32", [0.5, -1.5])).toEqual([0.5, -1.5]);
    expect(roundTrip("Float64", [1 / 3, -0])).toEqual([1 / 3, -0]);
    const arrays = Array.from({ length: n }, (_, i) =>
      [i, i + 1].slice(0, i % 3),
    );
    expect(roundTrip("Array(UInt32)", arrays)).toEqual(arrays);
    const nullable = Array.from({ length: n }, (_, i) =>
      i % 3 ? "s" + i : null,
    );
    expect(roundTrip("Nullable(String)", nullable)).toEqual(nullable);
    expect(roundTrip("Nothing", [null, null])).toEqual([null, null]);
  });

  it("infers the simple types of Dynamic values", () => {
    const out = roundTrip("Dynamic", [1, "x", 1.5, true, [1, 2], null]);
    expect(
      out.map((v) => (v instanceof TypedValue ? [v.type.name, v.value] : v)),
    ).toEqual([
      ["Int64", 1n],
      ["String", "x"],
      ["Float64", 1.5],
      ["Bool", true],
      ["Array(Int64)", [1n, 2n]],
      null,
    ]);
  });
});

describe("[Native] strings in a Dynamic column", () => {
  const dynamic = parseColumnType("Dynamic");
  const typeOf = (value: unknown, infer_dates?: boolean) =>
    (
      normalize(dynamic, value, { timezone: "UTC", infer_dates }) as {
        t: { name: string };
      }
    ).t.name;

  it("keeps each string as a String without the setting", () => {
    expect(typeOf("2024-01-02")).toBe("String");
    expect(typeOf("2024-01-02 03:04:05", false)).toBe("String");
  });

  it("asks for the server when a string can be a date", () => {
    for (const value of [
      "2024-01-02",
      "2024-1-2",
      "2024-01-02 03:04:05.5",
      "2024-01-02T03:04:05Z",
      "Jan 2 2024",
      "01/02/2024",
      "v1.2.3",
      ["x", "2024-01-02"],
      { a: { b: ["2024-01-02"] } },
    ]) {
      expect(() => typeOf(value, true)).toThrow(ServerParseNeeded);
    }
    expect(() =>
      normalize(parseColumnType("Array(Dynamic)"), ["2024-01-02"], {
        timezone: "UTC",
        infer_dates: true,
      }),
    ).toThrow(ServerParseNeeded);
  });

  it("encodes the strings that cannot be a date", () => {
    for (const value of [
      "",
      "abc",
      "x y",
      "20240102",
      "1700000000.5",
      "-1e5",
    ]) {
      expect(typeOf(value, true)).toBe("String");
    }
    expect(typeOf(["a", "b"], true)).toBe("Array(String)");
    expect(typeOf({ a: "x", n: 1 }, true)).toBe("Tuple(a String, n Int64)");
    expect(typeOf(5, true)).toBe("Int64");
  });
});

describe("[Native] encode edge cases", () => {
  it("round-trips empty Tuple() with one dummy byte per row", () => {
    const type = parseColumnType("Tuple()");
    const normalized = [[], [], []].map((v) => normalize(type, v, ctx));
    const { prefix, data } = encodeColumn(type, normalized);
    expect(prefix.toBuffer().length).toBe(0);
    expect(data.toBuffer().length).toBe(3);
    expect(roundTrip("Tuple()", [[], [], []])).toEqual([[], [], []]);
  });

  it("allows up to 254 distinct Dynamic types and falls back to server parsing at 255", () => {
    const dynamic = parseColumnType("Dynamic");
    const makeValues = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ [`k${i}`]: i }));

    const maxValues = makeValues(254);
    const decoded = roundTrip("Dynamic", maxValues);
    expect(decoded).toHaveLength(254);

    const tooMany = makeValues(255).map((v) => normalize(dynamic, v, ctx));
    expect(() => encodeColumn(dynamic, tooMany)).toThrow(ServerParseNeeded);
  });

  it("uses Object.hasOwn for named Tuple fields and catches invalid JSON in Tuple/Map", () => {
    const namedTuple = parseColumnType(
      "Tuple(toString String, constructor Int32, x Int32)",
    );
    expect(normalize(namedTuple, { x: 7 }, ctx)).toEqual([
      Buffer.alloc(0),
      0,
      7,
    ]);
    expect(
      roundTrip("Tuple(toString String, constructor Int32, x Int32)", [
        { x: 7 },
      ]),
    ).toEqual([["", 0, 7]]);

    const tupleType = parseColumnType("Tuple(Int32, Int32)");
    expect(() => normalize(tupleType, "[not json", ctx)).toThrow(
      InsertValueError,
    );

    const mapType = parseColumnType("Map(String, Int32)");
    expect(() => normalize(mapType, "{not json", ctx)).toThrow(
      InsertValueError,
    );
    expect(() => normalize(mapType, [1, 2], ctx)).toThrow(InsertValueError);
    expect(() => normalize(mapType, [["only_key"]], ctx)).toThrow(
      InsertValueError,
    );

    // Variant matching should recover from Tuple/Map parse failures with
    // InsertValueError instead of leaking SyntaxError or TypeError.
    const variantTuple = parseColumnType("Variant(Tuple(Int32, Int32), Int32)");
    expect(() => normalize(variantTuple, "[not json", ctx)).toThrow(
      InsertValueError,
    );

    const variantMapStr = parseColumnType("Variant(Map(String, Int32), Int32)");
    expect(() => normalize(variantMapStr, "{not json", ctx)).toThrow(
      InsertValueError,
    );

    const variantMapArr = parseColumnType("Variant(Map(String, Int32), Int32)");
    expect(() => normalize(variantMapArr, [1, 2], ctx)).toThrow(
      InsertValueError,
    );
  });
});
