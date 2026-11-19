import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClickHouseLogLevel,
  createClient as createHttpClient,
} from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { createClient } from "../../src";
import type { ClickHouseClient } from "../../src";
import { httpURL, nativeURL, uniqueName } from "./utils";

const settings = {
  enable_time_time64_type: 1,
  allow_experimental_variant_type: 1,
  allow_experimental_dynamic_type: 1,
  allow_experimental_json_type: 1,
} as const;

/**
 * Values that the two clients must store as the same value: one column type
 * and the values of its rows. The HTTP client sends the rows as JSON text,
 * and the server reads them. The native client encodes them.
 */
const sameValues: Array<[type: string, values: unknown[]]> = [
  [
    "DateTime('UTC')",
    [
      -1,
      0,
      4294967295,
      4294967296,
      5000000000,
      1.5,
      -1.5,
      1e20,
      "1960-01-01 00:00:00",
      "1969-12-31 23:59:59",
      "1970-01-01 00:00:00",
      "2106-02-07 06:28:15",
      "2106-02-07 06:28:16",
      "2200-01-01 00:00:00",
      "9999-12-31 23:59:59",
      "1700000000",
      "170000000",
      "9999999999",
      "1700000000123",
      "20240101",
      "202401",
      "20240101101010",
      "20240101101010.5",
      "2024-01-01",
      "2024-01-01 10:00",
      "2024-01-01 10:00:00.5",
      "2024-01-01T10:00:00Z",
      "2024-01-01T10:00:00+02:00",
      "2024-01-01 10:00:00 +0200",
      " 2024-01-01 10:00:00",
      "2024-01-01 25:00:00",
      "2024-01-01 10:60:00",
      "2024-1-5 1:02:03",
    ],
  ],
  [
    "DateTime('Europe/Berlin')",
    [
      -1,
      "1960-01-01 00:00:00",
      "1970-01-01 00:00:00",
      "1970-01-01 01:00:00",
      "2106-02-07 07:28:15",
      "2106-02-07 07:28:16",
      "20240101",
      "2024-07-01",
    ],
  ],
  [
    "Date",
    [
      0,
      65535,
      65536,
      86400,
      100000,
      1700000000,
      4294967296,
      1e15,
      true,
      false,
      "1960-01-01",
      "1800-01-01",
      "0001-01-01",
      "1970-01-01",
      "2149-06-06",
      "2149-06-07",
      "2300-01-01",
      "9999-12-31",
      "20240101",
      "20241301",
      "00000000",
      "2024-1-5",
      "2024-01-5",
      "2024/01/01",
      "2024-02-30",
      "2024-13-01",
      "2024-00-10",
      "2024-01-00",
      "2024-01-32",
      "0000-00-00",
    ],
  ],
  [
    "Date32",
    [
      -25567,
      -25568,
      -1,
      0,
      120530,
      200000,
      2932896,
      2932897,
      3000000,
      86400000,
      1700000000,
      2147483647,
      2147483648,
      -719528,
      -719529,
      -1000000,
      -2147483649,
      true,
      "0001-01-01",
      "1000-06-15",
      "1899-12-31",
      "1900-01-01",
      "2299-12-31",
      "2300-01-01",
      "9999-12-31",
      "20240101",
      "20241301",
      "2024.01.01",
      "2024-02-30",
      "2024-13-01",
      "2024-01-32",
      "0000-00-00",
    ],
  ],
  [
    "DateTime64(3, 'UTC')",
    [
      -1,
      0,
      1.5,
      -0.5,
      1.0005,
      1.9999,
      -1.9999,
      1700000000123,
      253402300799,
      253402300799.5,
      253402300800,
      1e12,
      1e15,
      -1e12,
      -2208988800,
      -2208988801,
      -62167219200,
      -62167219200.5,
      -62167219201,
      "1700000000",
      "170000000",
      "170000000.5",
      "1700000000.5",
      "1700000000.12345",
      "9999999999",
      "1700000000123",
      "1700000000123456",
      "1700000000123456789",
      "20240101",
      "202401",
      "20240101101010",
      "20240101101010.5",
      "0001-01-01 00:00:00",
      "1000-01-01 00:00:00",
      "1899-12-31 23:59:59.999",
      "1969-12-31 23:59:59.5",
      "2299-12-31 23:59:59.999",
      "2300-01-01 00:00:00",
      "9999-12-31 23:59:59.999",
      "2024-01-01",
      "2024-01-01 10:00",
      "2024-01-01 24:00:00",
      "2024-01-01 10:60:00",
      "2024-01-01 10:00:00+02:00",
      "2024-01-01T10:00:00.123456Z",
      "2024-01-01 10:00:00.1234567890123",
    ],
  ],
  [
    "DateTime64(6, 'UTC')",
    [
      1.0000005,
      1e12,
      "2255-06-06 00:00:00.999999",
      "2262-01-01 00:00:00.123457",
      "2299-12-31 23:59:59.999999",
      "9999-12-31 23:59:59.999999",
      "1900-01-01 00:00:00.000001",
      "1700000000",
      "1700000000.5",
      "1700000000123",
      "1700000000123456",
    ],
  ],
  [
    "DateTime64(9, 'UTC')",
    [
      -1,
      1.5,
      9223372036,
      -9223372036,
      "1900-01-01 00:00:00",
      "2262-04-11 23:47:16.854775807",
      "1700000000",
      "1700000000.123456789",
      "1700000000123",
      "1700000000123456789",
    ],
  ],
  [
    "DateTime64(0, 'UTC')",
    [-5, "1700000000", "2024-01-01 00:00:00", "2024-01-01 00:00:00.9"],
  ],
  [
    "Time",
    [
      62,
      -5,
      3599999,
      3600000,
      4000000,
      -3599999,
      -3600000,
      1e10,
      "1:02",
      "01:02",
      "-1:02",
      "-0:01",
      "0:00",
      "59:59",
      "60:00",
      "99:59",
      "1:60",
      "1:02:03",
      "01:02:03",
      "001:02:03",
      "1:02:60",
      "100:00:00",
      "999:59:59",
      "999:59:60",
      "-999:59:59",
      "-00:00:05",
      "00:00:60",
      "62",
      "1",
      "05",
      "-5",
      "-62",
    ],
  ],
  [
    "Time64(3)",
    [
      0,
      62,
      -62,
      3599999999,
      3600000000,
      -3599999999,
      -3600000000,
      1e15,
      "1:02",
      "1:02.5",
      "01:02:03.5",
      "1:02:03.1239",
      "1:02:03.",
      "1:02:60.5",
      "-01:02:03.500",
      "-0:00:00.5",
      "999:59:59.999",
      "999:59:59.9999",
      "62",
      "62.",
      "62.5",
      "-62.5",
      "0.5",
      "1",
      "5.",
      "-5",
      "12",
      "1.2345",
    ],
  ],
  ["Time64(6)", [62, 3599999999999, 3600000000000, "1:02:03.1234567"]],
  // null for a type that is not Nullable (input_format_null_as_default = 1)
  ["UInt8", [null, 1]],
  ["String", [null, "x"]],
  ["FixedString(3)", [null]],
  ["Bool", [null]],
  ["Float64", [null]],
  ["Decimal(9, 2)", [null]],
  ["UUID", [null]],
  ["IPv6", [null]],
  ["Date", [null]],
  ["DateTime64(3, 'UTC')", [null]],
  ["Enum8('a' = 1, 'b' = 2)", [null]],
  ["Enum8('c' = 1, 'a' = -1, 'b' = 0)", [null]],
  ["Enum8('x' = 5, 'b' = 2)", [null]],
  ["LowCardinality(String)", [null, "a"]],
  ["Array(Int32)", [[1, null, 3], null]],
  ["Array(Array(String))", [[null, ["a", null]]]],
  ["Array(Enum8('c' = 1, 'a' = -1))", [[null]]],
  ["Map(String, Int32)", [{ a: null }, null]],
  ["Map(String, Array(Int8))", [{ k: null }]],
  ["Tuple(a Int32, b String)", [{ a: null, b: "x" }, { b: "x" }, null]],
  ["Array(Tuple(a Int32, b Nullable(String)))", [[{ a: null, b: null }, null]]],
  ["JSON", [null, { a: 1 }]],
  ["Array(JSON)", [[null, { a: 1 }]]],
  // The types that hold null themselves
  ["Nullable(Int32)", [null, 1]],
  ["Array(Nullable(Int32))", [[null, 1]]],
  ["LowCardinality(Nullable(String))", [null, "a"]],
  ["Variant(String, UInt8)", [null, "a", 1]],
];

/** Values that the server rejects over HTTP. The native client must reject
 *  them too, with an error that names the value and the type. */
const rejectedValues: Array<[type: string, values: unknown[]]> = [
  [
    "DateTime('UTC')",
    [
      true,
      "",
      "abc",
      "nan",
      "-1",
      "12345",
      "1234567",
      "17000000000",
      "202401011010",
      "1700000000.7",
      "202413",
      "20241301",
      "2024-13-01 00:00:00",
      "2024-02-30 00:00:00",
    ],
  ],
  [
    "Date",
    [
      1.5,
      65536.5,
      "",
      "abc",
      "19000",
      "-5",
      "202401",
      " 2024-01-01",
      "2024-01-01 ",
      "2024-01-01 10:00:00",
      "2024-01-01T00:00:00",
      "2024-01-01Z",
    ],
  ],
  ["Date32", [1.5, "19000", "-5", "2024-01-01 10:00:00"]],
  [
    "DateTime64(3, 'UTC')",
    [
      true,
      1e300,
      -1e300,
      "abc",
      "nan",
      "-1",
      "-0.5",
      "12345",
      "99999999999",
      "1700000000123.5",
      "20240101.5",
      "202401011010",
      "2024-13-01 00:00:00",
      "2024-01-32 00:00:00",
      "2024-02-30 00:00:00",
      "10000-01-01 00:00:00",
    ],
  ],
  [
    "DateTime64(9, 'UTC')",
    [
      10000000000,
      9223372037,
      -9223372037,
      1e12,
      "-0.5",
      "2262-04-11 23:47:16.854775808",
      "2299-12-31 23:59:59.999999999",
      "1677-09-21 00:12:43.145224193",
      "1600-01-01 00:00:00",
    ],
  ],
  ["DateTime64(0, 'UTC')", ["17000000000"]],
  [
    "Time",
    [
      true,
      1.5,
      "",
      "abc",
      "123",
      "1:2:3",
      "12:3",
      "0:0",
      "100:00",
      "999:59",
      "1000:00",
      "1000:00:00",
      "1:02:03.5",
      "+1:02",
      " 1:02",
    ],
  ],
  ["Time64(3)", [1.5, ".5", "123", "1:2:3", "100:00.5", "1000:00:00"]],
];

/** JS values for a `Dynamic` column, for which the two clients must store
 *  the same type and the same value. */
const dynamicValues: unknown[] = [
  { a: 1 },
  { a: { b: "x" }, c: [1, 2] },
  { a: 1, b: { c: [{ d: 1 }] } },
  { a: null },
  { a: [] },
  { a: {} },
  { a: [null] },
  { a: [{ b: null }] },
  { a: [1, "x"] },
  { "a b": 1 },
  { "a.b": 1 },
  { "`q`": 1 },
  {},
  [],
  [null],
  [1, null],
  [true, false],
  [true, null],
  [1.5, null],
  ["a", null],
  [1, 2.5],
  [true, 1],
  [1, true, 2.5],
  [1, "a"],
  [1.5, "a"],
  [1, [2]],
  [[1], [2]],
  [[1], ["a"]],
  [[1], null],
  [[], [1]],
  [[1, 2], [1.5]],
  [{}],
  [{ a: 1 }],
  [{ a: 1 }, { b: "x" }],
  [{ a: 1 }, null],
  [{}, { a: 1 }],
  [{ a: 1 }, { a: 2.5 }],
  [{ a: [1] }, { a: [] }],
  [{ a: null }, { a: 1 }],
  [{ a: { x: 1 } }, { a: { y: "s" } }],
  [{ a: 1 }, [1]],
  "abc",
  "123",
  1.5,
  5,
  -5,
  9007199254740992,
  1e100,
  true,
  null,
];

describe("[Native] the same stored values as the HTTP client", () => {
  let http: HttpClient;
  let native: ClickHouseClient;
  beforeAll(() => {
    http = createHttpClient({
      url: httpURL(),
      clickhouse_settings: settings,
      // The server rejects some values on purpose: no error logs.
      log: { level: ClickHouseLogLevel.OFF },
    });
    native = createClient({ url: nativeURL(), clickhouse_settings: settings });
  });
  afterAll(async () => {
    await http.close();
    await native.close();
  });

  async function createTable(prefix: string, type: string): Promise<string> {
    const table = uniqueName(prefix);
    await http.command({
      query: `CREATE TABLE ${table} (id UInt32, x ${type}) ENGINE MergeTree ORDER BY id`,
    });
    return table;
  }

  async function contents(table: string, expression: string) {
    const rs = await http.query({
      query: `SELECT id, ${expression} AS x FROM ${table} ORDER BY id`,
      format: "JSONEachRow",
    });
    return rs.json<{ id: number; x: string }>();
  }

  async function drop(...tables: string[]): Promise<void> {
    for (const table of tables)
      await http.command({ query: `DROP TABLE ${table}` });
  }

  describe("stores the same values", () => {
    for (const [type, values] of sameValues) {
      it(type, async () => {
        const httpTable = await createTable("http_values", type);
        const nativeTable = await createTable("native_values", type);
        try {
          const rows = values.map((x, id) => ({ id, x }));
          await http.insert({
            table: httpTable,
            values: rows,
            format: "JSONEachRow",
          });
          await native.insert({
            table: nativeTable,
            values: rows,
            format: "JSONEachRow",
          });
          // Some releases store an Enum's numeric zero for NULL, including
          // when the Enum has no label for zero. Compare the stored numbers.
          const expression = type.startsWith("Enum8(")
            ? "toJSONString(CAST(x, 'Int8'))"
            : type.startsWith("Array(Enum8(")
              ? "toJSONString(arrayMap(v -> CAST(v, 'Int8'), x))"
              : "toJSONString(x)";
          const expected = await contents(httpTable, expression);
          expect(expected).toHaveLength(values.length);
          // The value of each row, to show the input when a row is different.
          const label = (rows: Array<{ id: number; x: string }>) =>
            rows.map((row) => [JSON.stringify(values[row.id]), row.x]);
          expect(label(await contents(nativeTable, expression))).toEqual(
            label(expected),
          );
        } finally {
          await drop(httpTable, nativeTable);
        }
      });
    }
  });

  it("uses the server's rule for a negative numeric Date", async () => {
    const httpTable = await createTable("http_negative_date", "Date");
    const nativeTable = await createTable("native_negative_date", "Date");
    async function outcome(
      client: HttpClient | ClickHouseClient,
      table: string,
    ) {
      try {
        await client.insert({
          table,
          values: [{ id: 1, x: -1 }],
          format: "JSONEachRow",
        });
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code === undefined) throw error;
        return { code };
      }
      return { rows: await contents(table, "toString(x)") };
    }
    try {
      const expected = await outcome(http, httpTable);
      expect(await outcome(native, nativeTable)).toEqual(expected);
    } finally {
      await drop(httpTable, nativeTable);
    }
  });

  describe("rejects the values that the server rejects", () => {
    for (const [type, values] of rejectedValues) {
      it(type, async () => {
        const httpTable = await createTable("http_rejected", type);
        const nativeTable = await createTable("native_rejected", type);
        try {
          for (const x of values) {
            const label = `${type} <- ${JSON.stringify(x)}`;
            await expect(
              http.insert({
                table: httpTable,
                values: [{ id: 1, x }],
                format: "JSONEachRow",
              }),
              `HTTP: ${label}`,
            ).rejects.toThrow();
            await expect(
              native.insert({
                table: nativeTable,
                values: [{ id: 1, x }],
                format: "JSONEachRow",
              }),
              `native: ${label}`,
            ).rejects.toThrow(
              /Cannot insert the value .* into a column of type/,
            );
          }
          expect(await contents(nativeTable, "toString(x)")).toEqual([]);
          // The client can run the next request.
          const next = await native.query({
            query: "SELECT 1 AS x",
            format: "JSONEachRow",
          });
          expect(await next.json()).toEqual([{ x: 1 }]);
        } finally {
          await drop(httpTable, nativeTable);
        }
      });
    }
  });

  it("rejects numbers that JSON cannot hold", async () => {
    const table = await createTable("native_nan", "DateTime('UTC')");
    try {
      for (const x of [NaN, Infinity, -Infinity]) {
        await expect(
          native.insert({
            table,
            values: [{ id: 1, x }],
            format: "JSONEachRow",
          }),
          String(x),
        ).rejects.toThrow(/Cannot insert the value .* into a column of type/);
      }
      expect(await contents(table, "toString(x)")).toEqual([]);
    } finally {
      await drop(table);
    }
  });

  it("stores the same types and values in a Dynamic column", async () => {
    const httpTable = await createTable("http_dynamic", "Dynamic");
    const nativeTable = await createTable("native_dynamic", "Dynamic");
    try {
      const rows = dynamicValues.map((x, id) => ({ id, x }));
      await http.insert({
        table: httpTable,
        values: rows,
        format: "JSONEachRow",
      });
      await native.insert({
        table: nativeTable,
        values: rows,
        format: "JSONEachRow",
      });
      const expression = "concat(dynamicType(x), ' = ', toJSONString(x))";
      const expected = await contents(httpTable, expression);
      expect(expected).toHaveLength(dynamicValues.length);
      const label = (rows: Array<{ id: number; x: string }>) =>
        rows.map((row) => [JSON.stringify(dynamicValues[row.id]), row.x]);
      expect(label(await contents(nativeTable, expression))).toEqual(
        label(expected),
      );
    } finally {
      await drop(httpTable, nativeTable);
    }
  });

  it("stores a bigint in a JSON column as a number", async () => {
    const table = await createTable("native_json_bigint", "JSON");
    try {
      await native.insert({
        table,
        values: [{ id: 1, x: { big: 12345678901234567890n, small: 5n } }],
        format: "JSONEachRow",
      });
      expect(await contents(table, "toJSONString(x)")).toEqual([
        { id: 1, x: '{"big":12345678901234567890,"small":5}' },
      ]);
      const types = await http.query({
        query: `SELECT dynamicType(x.big) AS big, dynamicType(x.small) AS small FROM ${table}`,
        format: "JSONEachRow",
      });
      expect(await types.json()).toEqual([{ big: "UInt64", small: "Int64" }]);
    } finally {
      await drop(table);
    }
  });
});
