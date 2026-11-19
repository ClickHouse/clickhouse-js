import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Stream from "stream";
import { createClient as createHttpClient } from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { createClient, SupportedNativeFormats } from "../../src";
import type { ClickHouseClient } from "../../src";
import { httpURL, nativeURL } from "./utils";

/**
 * The text of each format must be the same, byte for byte, as the text of
 * the HTTP interface. Each test runs one statement with `exec()` in the two
 * clients and compares the bytes of the two results.
 *
 * Only the values of the statistics and the progress rows are not compared:
 * they are different for each run.
 */
const settings = {
  enable_time_time64_type: 1,
  allow_experimental_variant_type: 1,
  allow_experimental_dynamic_type: 1,
  allow_experimental_json_type: 1,
  allow_suspicious_variant_types: 1,
} as const;

type Settings = Record<string, string | number>;

const cases: Array<[name: string, query: string]> = [
  [
    "integers",
    `SELECT toInt8(-128) i8, toUInt8(255) u8, toInt16(-32768) i16, toUInt16(65535) u16,
            toInt32(-2147483648) i32, toUInt32(4294967295) u32,
            toInt64('-9223372036854775808') i64, toUInt64('18446744073709551615') u64,
            toInt128('-170141183460469231731687303715884105728') i128,
            toUInt128('340282366920938463463374607431768211455') u128,
            toInt256('-57896044618658097711785492504343953926634992332820282019728792003956564819968') i256,
            toUInt256('115792089237316195423570985008687907853269984665640564039457584007913129639935') u256,
            true b, false b2, toIntervalSecond(5) iv`,
  ],
  [
    "floats",
    `SELECT toFloat32(0.1) f32, 1/3 f64, 1e21 big, 1.5e-7 small, -0. negzero, toFloat32(-0.) negzero32,
            nan n, inf i, -inf ni, toFloat32(3.4028235e38) f32max, 123456789.125 f, toBFloat16(1.5) bf,
            toFloat32(1e-10) f32small, toFloat32(16777216) f32int, toFloat32(1.17549435e-38) f32min, toFloat32(nan) n32`,
  ],
  [
    "decimals",
    `SELECT toDecimal32(1.5, 3) d32, toDecimal64(-123.456, 6) d64,
            toDecimal128('1234567890.123456789', 9) d128, toDecimal256('-1.5', 40) d256,
            toDecimal32(0, 2) zero, toDecimal64(-0.001, 3) neg, CAST(42, 'Decimal(10, 0)') int`,
  ],
  [
    "strings",
    `SELECT 'a/b"c\\\\d\\ttab\\nnl' s, '' empty, 'Привет ✓ 😀' unicode,
            toFixedString('ab', 4) fs, 'quote''s' q, '\\0\\b\\f\\r' ctrl, char(1, 31, 127) ctrl2,
            unhex('E280A8E280A9') ls, 'a,b;c' delim, ' sp ' sp`,
  ],
  [
    "dates",
    `SELECT toDate('2024-02-29') d, toDate32('1900-01-01') d32min, toDate32('2299-12-31') d32max,
            toDateTime('2024-03-31 01:30:00', 'Europe/Berlin') + 3600 dst,
            toDateTime('2024-10-27 02:30:00', 'Europe/Berlin') dst_back,
            toDateTime('2024-01-01 00:00:00', 'Asia/Kolkata') kolkata,
            toDateTime('2024-01-01 00:00:00') server_tz,
            toDateTime64('1969-12-31 23:59:59.123', 3, 'UTC') before_epoch,
            toDateTime64('2024-06-01 12:00:00.123456', 6, 'America/New_York') ny,
            toDateTime64('2024-01-01 00:00:00', 0) p0,
            toDateTime64('1900-01-01 00:00:00.5', 1, 'UTC') old,
            toDateTime(0, 'Australia/Lord_Howe') lord_howe`,
  ],
  [
    "time",
    `SELECT toTime('12:34:56') t, toTime64('01:02:03.456', 3) t64, toTime('-01:00:00') neg`,
  ],
  [
    "uuid and ip",
    `SELECT toUUID('61f0c404-5cb3-11e7-907b-a6006ad3dba0') u, toUUID('00000000-0000-0000-0000-000000000000') z,
            toIPv4('10.0.0.1') ip4, toIPv4('255.255.255.255') ip4max,
            toIPv6('::') a, toIPv6('::1') b, toIPv6('2001:db8::1') c, toIPv6('::ffff:1.2.3.4') d,
            toIPv6('1:0:0:1:0:0:0:1') e, toIPv6('fe80::1:2') f, toIPv6('1:2:3:4:5:6:7:8') g,
            toIPv6('1::') h, toIPv6('::1.2.3.4') i, toIPv6('0:0:1::') j`,
  ],
  [
    "enums",
    `SELECT CAST('a', 'Enum8(\\'a\\' = -1, \\'b c\\' = 2)') e8, CAST('b c', 'Enum8(\\'a\\' = -1, \\'b c\\' = 2)') e8b,
            CAST('x', 'Enum16(\\'x\\' = 1000)') e16`,
  ],
  [
    "nullable and low cardinality",
    `SELECT number,
            if(number % 2 = 0, NULL, number) n,
            toLowCardinality(toString(number % 3)) lc,
            CAST(if(number = 1, NULL, toString(number)), 'LowCardinality(Nullable(String))') lcn,
            CAST(NULL, 'Nullable(String)') always_null, NULL nothing
     FROM numbers(5)`,
  ],
  [
    "arrays, tuples, maps",
    `SELECT [1, 2, 3] a, [[1], [], [2, 3]] aa, [NULL, 'x'] an, [] empty,
            (1, 'x') t, CAST((1, 'x'), 'Tuple(a UInt8, b String)') nt,
            CAST((1, NULL), 'Tuple(a UInt8, b Nullable(String))') ntn,
            [CAST((1, [2]), 'Tuple(k UInt8, v Array(UInt8))')] at,
            map('k', [1, 2], 'z', []) m, map(1, 'a', 2, 'b') mi,
            CAST(map('a', 1), 'Map(LowCardinality(String), UInt64)') mlc,
            map('x', map('y', NULL)) mm,
            [toDate('2024-01-01')] ad, [toDecimal32(1.5, 2)] adec, [toUUID('61f0c404-5cb3-11e7-907b-a6006ad3dba0')] au,
            ['a"b', 'c''d', 'e\\\\f'] aq, [1.5, nan] af, [toDateTime('2024-01-01 00:00:00', 'UTC')] adt, [true, false] ab`,
  ],
  [
    "geo",
    `SELECT CAST((1, 2), 'Point') p, CAST([(1, 2), (3, 4)], 'Ring') r,
            CAST([[(1, 2), (3, 4)]], 'Polygon') pg`,
  ],
  [
    "variant",
    `SELECT CAST(x, 'Variant(String, UInt64, Array(UInt8))') v
     FROM (SELECT arrayJoin([toUInt64(1)::Variant(String, UInt64, Array(UInt8)), 'str', [1, 2]::Array(UInt8), NULL]) x)`,
  ],
  [
    "dynamic",
    `SELECT CAST(x, 'Dynamic') d
     FROM (SELECT arrayJoin([toUInt64(1)::Variant(UInt64, String, Array(UInt8), Date), 'str', [1, 2]::Array(UInt8), NULL, toDate('2024-01-01')]) x)`,
  ],
  [
    "json",
    `SELECT CAST(x, 'JSON') j FROM (SELECT arrayJoin([
       '{"a": {"b": 1, "c": [1, 2]}, "d": "x"}',
       '{"e": null, "f": [{"g": 1.5}], "h": true}',
       '{}'
     ]) x)`,
  ],
  [
    "json with typed paths",
    `SELECT CAST(x, 'JSON(a.b UInt32, s Nullable(String), max_dynamic_paths=1)') j FROM (SELECT arrayJoin([
       '{"a": {"b": 1, "c": [1, 2]}, "d": "x", "s": "y"}',
       '{"a": {"b": 2}, "z": {"y": 1}}'
     ]) x)`,
  ],
  [
    "simple aggregate function",
    `SELECT CAST(1, 'SimpleAggregateFunction(sum, UInt64)') s, CAST([1], 'SimpleAggregateFunction(groupArrayArray, Array(UInt8))') g`,
  ],
  [
    "empty result",
    `SELECT number, toString(number) s FROM numbers(10) WHERE 0`,
  ],
  [
    "three rows",
    `SELECT number, toString(number) s, [number] a FROM numbers(3)`,
  ],
  ["limit", `SELECT number FROM numbers(100) LIMIT 3`],
  [
    "column names",
    `SELECT 1 AS \`a/b\`, 2 AS \`q"t\`, 3 AS \`tab\\tname\`, 4 AS \`ю\``,
  ],
  [
    "tuple and null",
    `SELECT CAST((1, 'x'), 'Tuple(UInt8, String)') t, CAST(NULL, 'Nullable(String)') n`,
  ],
];

const totalsQuery =
  "SELECT number % 3 k, count() c, toString(k) s FROM numbers(10) GROUP BY k WITH TOTALS ORDER BY k";

const nested = `SELECT ['a','b'] as1, [[1],[2,3],[]] aa, [NULL, 1] an, [map('k',1)] am, [toLowCardinality('x')] alc,
  [(1,2)] atup, [[(1,2)]] aatup, [[[1]]] aaa, CAST(['{"a":1}'], 'Array(JSON)') aj, [1::Variant(UInt8, String), 's'] av,
  [1,2]::Variant(Array(UInt8), String) va, (1,'x')::Tuple(a UInt8, b String)::Dynamic dt, map('a', map('b', 1)) mm,
  map('a', []) mea, tuple(tuple()) tt, CAST((1, NULL), 'Tuple(a UInt8, b Nullable(String))') tn, map('a', (1,2)) mt,
  [[], []] aee, tuple([1,2], 'x') ta, (1, (2, 3)) tnest, map() me, [] ae,
  [[1,2]::Variant(Array(UInt8), String), 's'] av2, [[1,2]::Array(UInt8)::Dynamic, 5::UInt8::Dynamic] adyn,
  CAST((NULL, NULL), 'Tuple(a Nullable(UInt8), b Nullable(String))') tall, CAST((1,2), 'Tuple(\`x/y\` UInt8, z UInt8)') tslash,
  map('a/b', 1, 'q"', 2) mslash, CAST('{}', 'JSON') je,
  CAST('{"a": [[1,2],[3]], "b": [[1], null], "c": [{"x":1}, null], "d": [{"x":1}, 1], "e": [[1], "s"], "f": [[[1]]], "g": [[{"y": 1}]], "h": [[], []], "i": [null, null], "k": [{"x": [{"z": 1}]}], "l": [{}], "m": {"n": {"o": 1}}, "p": [[1, "a"]], "s": "q\\\\"t/u"}', 'JSON') j`;

const dates = `SELECT toDateTime('2024-01-01 12:00:00', 'Europe/Berlin') d, toDateTime64('2024-01-01 12:00:00.123', 3, 'Asia/Kolkata') d64,
  toDateTime64('2024-01-01 12:00:00', 0, 'UTC') p0, [toDateTime('2024-01-01 12:00:00', 'UTC')] a, (toDateTime('2024-01-01 12:00:00', 'UTC'), 1) t,
  map(toDateTime('2024-01-01 12:00:00', 'UTC'), toDateTime64('2024-01-01 12:00:00.5', 6, 'UTC')) m, toDate('2024-01-01') dd,
  CAST(toDateTime('2024-01-01 12:00:00', 'UTC'), 'Nullable(DateTime(\\'UTC\\'))') n, toDateTime64('2024-01-01 12:00:00.123456789', 9, 'UTC') p9,
  toDateTime('2024-01-01 12:00:00') server_tz`;

/** Statements with settings that change the text. */
const settingsCases: Array<[name: string, query: string, settings: Settings]> =
  [
    ["nested", nested, {}],
    [
      "nested, JSON by paths",
      nested,
      { output_format_native_write_json_as_string: 0 },
    ],
    [
      "nested, old serializations",
      nested,
      {
        output_format_native_write_json_as_string: 0,
        output_format_native_use_flattened_dynamic_and_json_serialization: 0,
      },
    ],
    [
      "nested, tuples as arrays",
      nested,
      { output_format_json_named_tuples_as_objects: 0 },
    ],
    [
      "nested, skip nulls",
      nested,
      { output_format_json_skip_null_value_in_named_tuples: 1 },
    ],
    ["nested, no pretty print", nested, { output_format_json_pretty_print: 0 }],
    [
      "nested, map as tuples",
      nested,
      { output_format_json_map_as_array_of_tuples: 1 },
    ],
    [
      "nested, map as tuples, tuples as arrays",
      nested,
      {
        output_format_json_map_as_array_of_tuples: 1,
        output_format_json_named_tuples_as_objects: 0,
      },
    ],
    [
      "no slash escape",
      "SELECT 'a/b' s, 1 AS `c/d`, map('e/f', 1) m",
      { output_format_json_escape_forward_slashes: 0 },
    ],
    [
      "array of rows",
      "SELECT number n, toString(number) s FROM numbers(3)",
      { output_format_json_array_of_rows: 1 },
    ],
    [
      "array of rows, empty",
      "SELECT number n FROM numbers(3) WHERE 0",
      { output_format_json_array_of_rows: 1 },
    ],
    [
      "no statistics",
      "SELECT number n FROM numbers(10) LIMIT 2",
      { output_format_write_statistics: 0 },
    ],
    [
      "kusto intervals",
      "SELECT toIntervalSecond(5) s, toIntervalDay(2) d, toIntervalMillisecond(1500) ms, toIntervalWeek(2) w, toIntervalHour(30) hh, toIntervalMinute(-90) mi, toIntervalMicrosecond(5) us, toIntervalNanosecond(700) ns, toIntervalSecond(0) z, toIntervalMillisecond(-86400001) big, [toIntervalSecond(5)] a, (toIntervalSecond(5), 1) t, CAST(NULL, 'Nullable(IntervalSecond)') n",
      { interval_output_format: "kusto" },
    ],
    [
      "csv tuples",
      "SELECT CAST((1,'x'), 'Tuple(a UInt8, b String)') t, (1, (2, 3)) u, 5 z",
      {},
    ],
    [
      "csv tuples, one column",
      "SELECT CAST((1,'x'), 'Tuple(a UInt8, b String)') t, (1, (2, 3)) u, 5 z",
      { output_format_csv_serialize_tuple_into_separate_columns: 0 },
    ],
    [
      "csv tuples, one header column",
      "SELECT CAST((1,'x'), 'Tuple(a UInt8, b String)') t, (1, (2, 3)) u, 5 z",
      { output_format_csv_header_serialize_tuple_into_separate_columns: 0 },
    ],
    [
      "nullable tuple",
      "SELECT CAST((1, 'x'), 'Nullable(Tuple(UInt8, String))') nt, CAST(NULL, 'Nullable(Tuple(UInt8, String))') nn, [CAST((1,'x'), 'Nullable(Tuple(a UInt8, b String))')] ant, 5 z",
      { allow_experimental_nullable_tuple_type: 1 },
    ],
    [
      "object name column",
      "SELECT concat('k/', toString(number)) name, number n FROM numbers(3)",
      { format_json_object_each_row_column_for_object_name: "name" },
    ],
    [
      "text settings",
      "SELECT true b, false f, NULL n, 'a;b' s, toDecimal32(1.5, 3) d, [true] ab, CAST(NULL, 'Nullable(Bool)') nb",
      {
        bool_true_representation: "yes",
        bool_false_representation: "no",
        format_csv_delimiter: ";",
        format_csv_null_representation: "<null>",
        format_tsv_null_representation: "<n>",
        output_format_decimal_trailing_zeros: 1,
        output_format_csv_crlf_end_of_line: 1,
        output_format_tsv_crlf_end_of_line: 1,
      },
    ],
    [
      "json quoting",
      "SELECT toUInt64(1) u, toInt128(2) i, toDecimal32(1.5, 3) d, 1.5 f, toFloat32(1.5) f32, nan n, -inf ni, [toUInt64(1)] au, map('k', toUInt64(2)) mu",
      {
        output_format_json_quote_64bit_integers: 1,
        output_format_json_quote_decimals: 1,
        output_format_json_quote_64bit_floats: 1,
        output_format_json_quote_denormals: 1,
      },
    ],
    [
      "totals with nested",
      "SELECT number % 2 k, groupArray(number) a, groupArray((number, toString(number))) t, CAST((sum(number), 'x'), 'Tuple(s UInt64, x String)') nt FROM numbers(4) GROUP BY k WITH TOTALS ORDER BY k",
      { extremes: 1 },
    ],
    [
      "dates, iso",
      dates + ", toDateTime64('1969-12-31 23:59:59.5', 1, 'UTC') neg",
      { date_time_output_format: "iso" },
    ],
    [
      "dates, unix_timestamp",
      dates,
      { date_time_output_format: "unix_timestamp" },
    ],
    ["dates, simple", dates, { date_time_output_format: "simple" }],
    [
      "bytes that are not UTF-8",
      "SELECT unhex('41FFFFFF42C3') s, toFixedString(unhex('FF41'), 3) fs, [unhex('E28041')] a, map(unhex('C0AF'), unhex('EDA080')) m, 'ok ✓ 😀 𐂀' valid, unhex('F0908280FF') mixed",
      {},
    ],
    [
      "bytes that are not UTF-8, validate",
      "SELECT unhex('41FFFFFF42C3') s, toFixedString(unhex('FF41'), 3) fs, [unhex('E28041')] a, 'ok ✓ 😀 𐂀' valid, unhex('F0908280FF') mixed, unhex('E28080E280') tail",
      { output_format_json_validate_utf8: 1 },
    ],
    [
      "settings in the SQL",
      "SELECT toUInt64(1) u, nan n, toDateTime('2024-01-01 12:00:00', 'UTC') d, 'a/b' s SETTINGS output_format_json_quote_64bit_integers = 1, output_format_json_quote_denormals=1, date_time_output_format = 'iso', output_format_json_escape_forward_slashes = 0",
      {},
    ],
  ];

/** The server writes `,` lines between the rows of JSONEachRowWithProgress
 *  when `output_format_json_array_of_rows` is set. The client does not. */
const skipped = new Set(["array of rows: JSONEachRowWithProgress"]);

/** Hides the parts of a result that are different for each run. */
function mask(text: string): string {
  return text
    .replace(/("elapsed": )[0-9.e-]+/g, "$1X")
    .replace(/("rows_read": )\d+/g, "$1X")
    .replace(/("bytes_read": )\d+/g, "$1X")
    .replace(/^\{"progress":.*\}\n/gm, "");
}

interface ExecClient {
  exec(params: {
    query: string;
    clickhouse_settings?: Settings;
  }): Promise<{ stream: Stream.Readable }>;
}

/** The bytes of a result. Each byte is one character of the string, so a
 *  failed test shows the bytes that are different. */
async function resultBytes(
  client: ExecClient,
  query: string,
  clickhouse_settings: Settings,
): Promise<string> {
  const { stream } = await client.exec({ query, clickhouse_settings });
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return mask(Buffer.concat(chunks).toString("latin1"));
}

describe("[Native] the same bytes as the HTTP interface", () => {
  let native: ClickHouseClient;
  let http: HttpClient;

  beforeAll(() => {
    native = createClient({ url: nativeURL(), clickhouse_settings: settings });
    http = createHttpClient({ url: httpURL(), clickhouse_settings: settings });
  });
  afterAll(async () => {
    await native.close();
    await http.close();
  });

  function compare(name: string, query: string, st: Settings = {}): void {
    describe(name, () => {
      for (const format of SupportedNativeFormats) {
        it.skipIf(skipped.has(`${name}: ${format}`))(format, async () => {
          const sql = `${query} FORMAT ${format}`;
          const [n, h] = await Promise.all([
            resultBytes(native as unknown as ExecClient, sql, st),
            resultBytes(http as unknown as ExecClient, sql, st),
          ]);
          expect(n).toBe(h);
        });
      }
    });
  }

  for (const [name, query] of cases) compare(name, query);

  compare("totals", totalsQuery);
  compare("totals and extremes", totalsQuery, { extremes: 1 });
  compare("extremes", "SELECT number, toString(number) s FROM numbers(5)", {
    extremes: 1,
  });
  compare(
    "totals with a limit",
    "SELECT number % 3 k, count() c FROM numbers(10) GROUP BY k WITH TOTALS ORDER BY k LIMIT 2",
  );

  for (const [name, query, st] of settingsCases) compare(name, query, st);
});
