import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createHttpClient } from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { createClient } from "../../src";
import type { ClickHouseClient, DataFormat } from "../../src";
import { httpURL, nativeURL } from "./utils";

/**
 * `json()` makes the rows from the decoded blocks: it does not write and
 * parse their JSON text. The values must be the values that `JSON.parse`
 * gives for the text of the HTTP interface.
 */
const base = {
  enable_time_time64_type: 1,
  allow_experimental_variant_type: 1,
  allow_experimental_dynamic_type: 1,
  allow_experimental_json_type: 1,
  allow_suspicious_variant_types: 1,
} as const;

const select = `
  SELECT
    number AS n, toInt8(number % 100 - 50) AS i8, toUInt64('18446744073709551615') - number AS u64,
    toInt128('-170141183460469231731687303715884105728') + number AS i128,
    toFloat32(number / 3) AS f32, number / 7 AS f64, -0. AS negzero, toFloat32(-0.) AS negzero32,
    if(number % 4 = 0, nan, number) AS denormal, if(number % 5 = 0, inf, -inf) AS infinite,
    toDecimal64(number / 8, 6) AS d64, toDecimal128('-1234567890.123456789', 9) AS d128,
    number % 2 = 0 AS b, toString(number) AS s, 'a/b"c\\\\d\\n ✓ 😀' AS text, toFixedString('ab', 4) AS fs,
    toDate('2024-02-29') + number AS d, toDateTime(1700000000 + number, 'Europe/Berlin') AS dt,
    toDateTime64(1700000000.123 + number, 3, 'UTC') AS dt64, toIntervalSecond(number) AS iv,
    toUUID('61f0c404-5cb3-11e7-907b-a6006ad3dba0') AS u, toIPv4('10.0.0.1') AS ip4, toIPv6('2001:db8::1') AS ip6,
    CAST(if(number % 2 = 0, 'a', 'b'), 'Enum8(''a'' = 1, ''b'' = 2)') AS e,
    if(number % 3 = 0, NULL, number) AS nullable, toLowCardinality(toString(number % 3)) AS lc,
    [number, number + 1] AS a, [[toString(number)], []] AS aa, [NULL, toInt64(number)] AS an,
    (number, 'x') AS t, CAST((number, 'y'), 'Tuple(a UInt64, b Nullable(String))') AS nt,
    CAST((number, NULL), 'Tuple(a UInt64, b Nullable(String))') AS nt_null,
    map('k', number, 'z', number + 1) AS m, map(number, 'v') AS m_int, map(toDate('2024-01-01'), [1]) AS m_date,
    CAST(number, 'Variant(String, UInt64)') AS v, CAST(toString(number), 'Dynamic') AS dyn,
    CAST('{"a": {"b": 1}, "c": [1, 2]}', 'JSON') AS j, CAST(NULL, 'Nullable(Nothing)') AS nothing,
    42 AS \`__proto__\`, 1 AS \`a/b\`
  FROM numbers(7)`;

const variants: Array<[string, Record<string, string | number>]> = [
  ["the default settings", {}],
  [
    "quoted numbers",
    {
      output_format_json_quote_64bit_integers: 1,
      output_format_json_quote_64bit_floats: 1,
      output_format_json_quote_decimals: 1,
      output_format_json_quote_denormals: 1,
    },
  ],
  [
    "numbers that are not quoted",
    {
      output_format_json_quote_64bit_integers: 0,
      output_format_json_quote_64bit_floats: 0,
      output_format_json_quote_decimals: 0,
      output_format_json_quote_denormals: 0,
    },
  ],
  [
    "tuples as arrays and maps as arrays of tuples",
    {
      output_format_json_named_tuples_as_objects: 0,
      output_format_json_map_as_array_of_tuples: 1,
    },
  ],
  [
    "named tuples without null values",
    { output_format_json_skip_null_value_in_named_tuples: 1 },
  ],
  [
    "other text of dates and intervals",
    { date_time_output_format: "iso", interval_output_format: "kusto" },
  ],
  ["JSON text of more than one line", { output_format_json_pretty_print: 1 }],
];

const formats: DataFormat[] = [
  "JSON",
  "JSONCompact",
  "JSONEachRow",
  "JSONCompactEachRow",
  "JSONCompactEachRowWithNames",
  "JSONCompactEachRowWithNamesAndTypes",
  // These formats have no direct path: the result must be the same.
  "JSONStringsEachRow",
  "JSONObjectEachRow",
  "JSONColumnsWithMetadata",
];

function withoutStatistics(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  const { statistics: _statistics, ...rest } = value as Record<string, unknown>;
  return rest;
}

describe("[Native] json() without the JSON text", () => {
  let native: ClickHouseClient;
  let http: HttpClient;

  beforeAll(() => {
    native = createClient({ url: nativeURL(), clickhouse_settings: base });
    http = createHttpClient({ url: httpURL(), clickhouse_settings: base });
  });
  afterAll(async () => {
    await native.close();
    await http.close();
  });

  for (const [name, clickhouse_settings] of variants) {
    describe(name, () => {
      it.each(formats)("%s", async (format) => {
        const params = { query: select, format, clickhouse_settings };
        const expected = await http.query(params).then((rs) => rs.json());
        const fromText = await native
          .query(params)
          .then((rs) => rs.text())
          .then((text) =>
            format.includes("EachRow") && format !== "JSONObjectEachRow"
              ? text
                  .split("\n")
                  .filter((line) => line !== "")
                  .map((line) => JSON.parse(line))
              : JSON.parse(text),
          );
        const actual = await native.query(params).then((rs) => rs.json());
        // toEqual tells 0 from -0.
        expect(withoutStatistics(actual)).toEqual(withoutStatistics(expected));
        expect(withoutStatistics(actual)).toEqual(withoutStatistics(fromText));
      });
    });
  }

  it("keeps a field with the name __proto__ as a usual field", async () => {
    const rows = await native
      .query({
        query: "SELECT 42 AS `__proto__`, 1 AS x",
        format: "JSONEachRow",
      })
      .then((rs) => rs.json<Record<string, unknown>>());
    expect(Object.keys(rows[0]!)).toEqual(["__proto__", "x"]);
    expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
  });

  it.each([
    "JSON",
    "JSONCompact",
    "JSONEachRow",
    "JSONCompactEachRow",
  ] as const)("gives the rows of many blocks in %s", async (format) => {
    const params = {
      query:
        "SELECT number, toString(number) AS s, [number] AS a FROM numbers(50000)",
      format,
      clickhouse_settings: { max_block_size: "7000" },
    };
    const actual = await native.query(params).then((rs) => rs.json());
    const expected = await http.query(params).then((rs) => rs.json());
    expect(withoutStatistics(actual)).toEqual(withoutStatistics(expected));
  });

  it.each(["JSON", "JSONCompact"] as const)(
    "keeps totals, extremes and the row counts in %s",
    async (format) => {
      const params = {
        query:
          "SELECT number % 3 AS k, count() AS c FROM numbers(100) GROUP BY k WITH TOTALS ORDER BY k LIMIT 2",
        format,
        clickhouse_settings: { extremes: 1 },
      };
      const actual = await native
        .query(params)
        .then((rs) => rs.json<Record<string, unknown>>());
      const expected = await http
        .query(params)
        .then((rs) => rs.json<Record<string, unknown>>());
      expect(withoutStatistics(actual)).toEqual(withoutStatistics(expected));
      expect(Object.keys(actual)).toEqual(Object.keys(expected));
      expect(actual["rows"]).toBe(2);
      expect(actual["rows_before_limit_at_least"]).toBe(3);
    },
  );

  it.each(["JSON", "JSONEachRow"] as const)(
    "gives an empty result in %s",
    async (format) => {
      const params = { query: "SELECT 1 AS x WHERE 0", format };
      const actual = await native.query(params).then((rs) => rs.json());
      const expected = await http.query(params).then((rs) => rs.json());
      expect(withoutStatistics(actual)).toEqual(withoutStatistics(expected));
    },
  );

  it.each([
    "JSON",
    "JSONCompact",
    "JSONEachRow",
    "JSONCompactEachRow",
  ] as const)(
    "gives the same strings for bytes that are not UTF-8 in %s",
    async (format) => {
      const params = {
        query:
          "SELECT unhex('FF41C3') AS s, [unhex('F09080'), 'é'] AS a, map(unhex('C0'), unhex('80')) AS m, (unhex('ED'), 1) AS t, number FROM numbers(3)",
        format,
      };
      const actual = await native.query(params).then((rs) => rs.json());
      const expected = await http.query(params).then((rs) => rs.json());
      expect(withoutStatistics(actual)).toEqual(withoutStatistics(expected));
    },
  );

  it("gives the text to a JSON parser of the caller", async () => {
    const texts: string[] = [];
    const client = createClient({
      url: nativeURL(),
      json: {
        parse: <T>(text: string): T => {
          texts.push(text);
          return JSON.parse(text, (_key, value: unknown) =>
            typeof value === "number" ? String(value) : value,
          ) as T;
        },
        stringify: JSON.stringify,
      },
    });
    try {
      const params = { query: "SELECT number AS n FROM numbers(2)" };
      const rows = await client
        .query({ ...params, format: "JSONEachRow" })
        .then((rs) => rs.json());
      expect(rows).toEqual([{ n: "0" }, { n: "1" }]);
      expect(texts).toEqual(['{"n":0}', '{"n":1}']);
      const document = await client
        .query({ ...params, format: "JSONCompact" })
        .then((rs) => rs.json<{ data: unknown[]; rows: unknown }>());
      expect(document.data).toEqual([["0"], ["1"]]);
      expect(document.rows).toBe("2");
    } finally {
      await client.close();
    }
  });

  it("gives the same rows with stream()", async () => {
    const params = {
      query: select.replace("numbers(7)", "numbers(3000)"),
      format: "JSONEachRow" as const,
      clickhouse_settings: { max_block_size: "700" },
    };
    const collect = async (client: ClickHouseClient | HttpClient) => {
      const rs = await (client as HttpClient).query(params);
      const texts: string[] = [];
      const values: unknown[] = [];
      for await (const rows of rs.stream()) {
        for (const row of rows) {
          texts.push(row.text);
          values.push(row.json());
        }
      }
      return { texts, values };
    };
    const actual = await collect(native);
    const expected = await collect(http);
    expect(actual.texts.length).toBe(3000);
    expect(actual.texts).toEqual(expected.texts);
    expect(actual.values).toEqual(expected.values);
    expect(await native.query(params).then((rs) => rs.json())).toEqual(
      expected.values,
    );
  });

  it("fails json() when the server fails after the first rows", async () => {
    for (let i = 0; i < 10; i++) {
      // The error comes before or after the first rows: query() or json()
      // fails.
      const failure = native
        .query({
          query:
            "SELECT throwIf(number = 70000, 'boom') AS x FROM numbers(100000) SETTINGS max_block_size = 65000",
          format: "JSONEachRow",
        })
        .then((rs) => rs.json());
      await expect(failure).rejects.toThrow("boom");
    }
  });
});
