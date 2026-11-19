import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createHttpClient } from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { createClient } from "../../src";
import type { ClickHouseClient, DataFormat } from "../../src";
import { httpURL, nativeURL } from "./utils";

/**
 * The native client must give the same results as the HTTP client. Each case
 * runs one query with both clients and compares the results.
 */
const settings = {
  enable_time_time64_type: 1,
  allow_experimental_variant_type: 1,
  allow_experimental_dynamic_type: 1,
  allow_experimental_json_type: 1,
  allow_suspicious_variant_types: 1,
} as const;

const cases: Array<[string, string]> = [
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
    `SELECT toFloat32(0.1) f32, 1/3 f64, 1e21 big, 1.5e-7 small, -0. negzero,
            nan n, inf i, -inf ni, toFloat32(3.4028235e38) f32max, 123456789.125 f, toBFloat16(1.5) bf`,
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
            toFixedString('ab', 4) fs, 'quote''s' q, '\\0\\b\\f\\r' ctrl`,
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
            [toDate('2024-01-01')] ad, [toDecimal32(1.5, 2)] adec, [toUUID('61f0c404-5cb3-11e7-907b-a6006ad3dba0')] au`,
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
    "dynamic over max_types",
    `SELECT CAST(x, 'Dynamic(max_types=1)') d
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
    "many blocks",
    `SELECT number, toString(number) s FROM numbers(30000) SETTINGS max_block_size = 1000`,
  ],
  ["limit", `SELECT number FROM numbers(100) LIMIT 3`],
];

const jsonFormats: DataFormat[] = [
  "JSONEachRow",
  "JSONCompactEachRow",
  "JSONStringsEachRow",
  "JSONCompactStringsEachRowWithNamesAndTypes",
  "JSONObjectEachRow",
];
const textFormats: DataFormat[] = [
  "CSVWithNamesAndTypes",
  "TabSeparatedWithNamesAndTypes",
  "TabSeparatedRaw",
];

describe("[Native] the same results as the HTTP client", () => {
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

  for (const [name, query] of cases) {
    describe(name, () => {
      for (const format of jsonFormats) {
        it(format, async () => {
          const [n, h] = await Promise.all([
            native.query({ query, format }).then((rs) => rs.json()),
            http.query({ query, format }).then((rs) => rs.json()),
          ]);
          expect(n).toEqual(h);
        });
      }
      for (const format of textFormats) {
        it(format, async () => {
          const [n, h] = await Promise.all([
            native.query({ query, format }).then((rs) => rs.text()),
            http.query({ query, format }).then((rs) => rs.text()),
          ]);
          expect(n).toEqual(h);
        });
      }
      it("JSON", async () => {
        const [n, h] = await Promise.all([
          native.query({ query, format: "JSON" }).then((rs) => rs.json()),
          http.query({ query, format: "JSON" }).then((rs) => rs.json()),
        ]);
        const { statistics: _n, ...nativeDoc } = n;
        const { statistics: _h, ...httpDoc } = h;
        expect(nativeDoc).toEqual(httpDoc);
      });
    });
  }

  // Older servers do not know the settings that make the server send Dynamic
  // as a flat list of types and JSON as text. Turn them off to test the
  // decoders of the other serializations.
  describe("without the simplified Dynamic and JSON serializations", () => {
    const clickhouse_settings = {
      output_format_native_use_flattened_dynamic_and_json_serialization: 0,
      output_format_native_write_json_as_string: 0,
    } as const;
    const names = [
      "variant",
      "dynamic",
      "dynamic over max_types",
      "json",
      "json with typed paths",
    ];
    for (const [name, query] of cases.filter(([n]) => names.includes(n))) {
      for (const format of ["JSONEachRow", "JSONStringsEachRow"] as const) {
        it(`${name}: ${format}`, async () => {
          const [n, h] = await Promise.all([
            native
              .query({ query, format, clickhouse_settings })
              .then((rs) => rs.json()),
            http.query({ query, format }).then((rs) => rs.json()),
          ]);
          expect(n).toEqual(h);
        });
      }
    }
  });

  it("follows the output settings of the query", async () => {
    const query = "SELECT toUInt64(1) u, toDecimal32(1.5, 3) d, 1.5 f, nan n";
    const clickhouse_settings = {
      output_format_json_quote_64bit_integers: 1,
      output_format_json_quote_decimals: 1,
      output_format_json_quote_64bit_floats: 1,
      output_format_json_quote_denormals: 1,
      output_format_decimal_trailing_zeros: 1,
    } as const;
    const [n, h] = await Promise.all([
      native
        .query({ query, format: "JSONEachRow", clickhouse_settings })
        .then((rs) => rs.text()),
      http
        .query({ query, format: "JSONEachRow", clickhouse_settings })
        .then((rs) => rs.text()),
    ]);
    expect(n).toEqual(h);
  });

  it("uses session_timezone for DateTime columns without a time zone", async () => {
    const query =
      "SELECT toDateTime('2024-01-01 12:00:00') dt, now() IS NOT NULL ok";
    const clickhouse_settings = { session_timezone: "Asia/Tokyo" };
    const [n, h] = await Promise.all([
      native
        .query({ query, format: "JSONEachRow", clickhouse_settings })
        .then((rs) => rs.json()),
      http
        .query({ query, format: "JSONEachRow", clickhouse_settings })
        .then((rs) => rs.json()),
    ]);
    expect(n).toEqual(h);
  });

  it("writes totals and extremes", async () => {
    const query =
      "SELECT number % 3 k, count() c FROM numbers(10) GROUP BY k WITH TOTALS ORDER BY k";
    const clickhouse_settings = { extremes: 1 } as const;
    for (const format of ["JSON", "JSONCompact"] as const) {
      const [n, h] = await Promise.all([
        native
          .query({ query, format, clickhouse_settings })
          .then((rs) => rs.json()),
        http
          .query({ query, format, clickhouse_settings })
          .then((rs) => rs.json()),
      ]);
      const { statistics: _n, ...nativeDoc } = n;
      const { statistics: _h, ...httpDoc } = h;
      expect(nativeDoc).toEqual(httpDoc);
    }
  });
});
