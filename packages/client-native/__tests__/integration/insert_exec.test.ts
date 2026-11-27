import Stream from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createHttpClient } from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { createClient } from "../../src";
import type { ClickHouseClient } from "../../src";
import { isZstdAvailable } from "../../src/compression/frames";
import { httpURL, nativeURL, uniqueName } from "./utils";

const settings = {
  enable_time_time64_type: 1,
  allow_experimental_variant_type: 1,
  allow_experimental_dynamic_type: 1,
  allow_experimental_json_type: 1,
} as const;

const columns = `
  id UInt64,
  i8 Int8, u32 UInt32, i128 Int128, f32 Float32, f64 Float64,
  d Decimal(10, 3), d128 Decimal(30, 6), b Bool,
  s String, fs FixedString(4), e Enum8('a' = 1, 'b' = 2),
  dt Date, d32 Date32, ts DateTime('Europe/Berlin'), ts64 DateTime64(3, 'UTC'), tm Time64(3),
  u UUID, ip4 IPv4, ip6 IPv6,
  n Nullable(Int32), lc LowCardinality(String), lcn LowCardinality(Nullable(String)),
  a Array(Nullable(String)), aa Array(Array(UInt8)), m Map(String, UInt64),
  t Tuple(x UInt8, y String), v Variant(String, UInt64, Array(UInt8)), dyn Dynamic, j JSON,
  def_s String DEFAULT 'default', def_n UInt64 DEFAULT id * 10`;

const rows = [
  {
    id: 1,
    i8: -5,
    u32: 4000000000,
    i128: "-170141183460469231731687303715884105728",
    f32: 0.5,
    f64: 1 / 3,
    d: "1.25",
    d128: "123456789012345678.123456",
    b: true,
    s: 'it\'s a "test"\n',
    fs: "ab",
    e: "b",
    dt: "2024-02-29",
    d32: "1900-01-01",
    ts: "2024-03-31 03:30:00",
    ts64: "2024-01-01 12:00:00.123",
    tm: "-01:02:03.500",
    u: "61f0c404-5cb3-11e7-907b-a6006ad3dba0",
    ip4: "10.0.0.1",
    ip6: "2001:db8::1",
    n: null,
    lc: "x",
    lcn: null,
    a: ["p", null],
    aa: [[1, 2], []],
    m: { k: 1, z: 2 },
    t: { x: 1, y: "y" },
    v: 42,
    dyn: "text",
    j: { a: { b: 1 }, c: [1, 2] },
  },
  {
    id: 2,
    i8: 127,
    u32: 0,
    i128: 5,
    f32: -1.5,
    f64: 1e300,
    d: -2,
    d128: 0,
    b: false,
    s: "",
    fs: "abcd",
    e: "a",
    dt: "1970-01-01",
    d32: "2299-12-31",
    ts: "2024-10-27 02:30:00",
    ts64: "1969-12-31 23:59:59.999",
    tm: "100:00:00",
    u: "00000000-0000-0000-0000-000000000000",
    ip4: "255.255.255.255",
    ip6: "::ffff:1.2.3.4",
    n: -7,
    lc: "",
    lcn: "y",
    a: [],
    aa: [],
    m: {},
    t: { x: 0, y: "" },
    v: "str",
    dyn: 5,
    j: {},
    def_s: "given",
    def_n: 1,
  },
  {
    id: 3,
    i8: 0,
    u32: 1,
    i128: 0,
    f32: 0,
    f64: 0,
    d: 0,
    d128: 0,
    b: true,
    s: "Привет ✓",
    fs: "",
    e: 1,
    dt: "2024-01-01",
    d32: "2024-01-01",
    ts: "2024-01-01 00:00:00",
    ts64: "2024-01-01 00:00:00",
    tm: "00:00:00",
    u: "61f0c404-5cb3-11e7-907b-a6006ad3dba0",
    ip4: "0.0.0.0",
    ip6: "::",
    n: 1,
    lc: "x",
    lcn: "x",
    a: [null],
    aa: [[3]],
    m: { k: 0 },
    t: { x: 255, y: "z" },
    v: [1, 2],
    dyn: [1, 2],
    j: { s: "x" },
  },
];

describe("[Native] insert and exec", () => {
  let http: HttpClient;
  beforeAll(() => {
    http = createHttpClient({ url: httpURL(), clickhouse_settings: settings });
  });
  afterAll(async () => {
    await http.close();
  });

  async function createTables(): Promise<[string, string]> {
    const nativeTable = uniqueName("native_insert");
    const httpTable = uniqueName("http_insert");
    for (const table of [nativeTable, httpTable]) {
      await http.command({
        query: `CREATE TABLE ${table} (${columns}) ENGINE MergeTree ORDER BY id`,
      });
    }
    return [nativeTable, httpTable];
  }

  async function contents(table: string): Promise<unknown[]> {
    const rs = await http.query({
      query: `SELECT * FROM ${table} ORDER BY id`,
      format: "JSONEachRow",
    });
    return rs.json();
  }

  async function dropTables(...tables: string[]): Promise<void> {
    for (const table of tables)
      await http.command({ query: `DROP TABLE ${table}` });
  }

  for (const compression of ["none", "lz4", "zstd"] as const) {
    describe.skipIf(compression === "zstd" && !isZstdAvailable())(
      `compression: ${compression}`,
      () => {
        let native: ClickHouseClient;
        beforeAll(() => {
          native = createClient({
            url: nativeURL(),
            compression,
            clickhouse_settings: settings,
          });
        });
        afterAll(async () => {
          await native.close();
        });

        it("inserts the same JSONEachRow rows as the HTTP client", async () => {
          const [nativeTable, httpTable] = await createTables();
          try {
            const result = await native.insert({
              table: nativeTable,
              values: rows,
              format: "JSONEachRow",
            });
            expect(result.executed).toBe(true);
            expect(result.summary?.written_rows).toBe(String(rows.length));
            await http.insert({
              table: httpTable,
              values: rows,
              format: "JSONEachRow",
            });
            const [n, h] = [
              await contents(nativeTable),
              await contents(httpTable),
            ];
            expect(n).toEqual(h);
          } finally {
            await dropTables(nativeTable, httpTable);
          }
        });

        it("returns the same query results as without compression", async () => {
          const query =
            "SELECT number, toString(number) s, [number] a FROM numbers(200000) SETTINGS max_block_size = 70000";
          const rs = await native.query({
            query,
            format: "JSONCompactEachRow",
          });
          const result = await rs.json<[number, string, number[]]>();
          expect(result.length).toBe(200000);
          expect(result[199999]).toEqual([199999, "199999", [199999]]);
        });
      },
    );
  }

  describe("formats", () => {
    let native: ClickHouseClient;
    beforeAll(() => {
      native = createClient({
        url: nativeURL(),
        clickhouse_settings: settings,
      });
    });
    afterAll(async () => {
      await native.close();
    });

    const simple =
      "id UInt64, s String, n Nullable(Float64), d UInt64 DEFAULT id * 10";

    async function compare(
      insert: (
        client: ClickHouseClient | HttpClient,
        table: string,
      ) => Promise<unknown>,
    ): Promise<void> {
      const nativeTable = uniqueName("native_fmt");
      const httpTable = uniqueName("http_fmt");
      for (const table of [nativeTable, httpTable]) {
        await http.command({
          query: `CREATE TABLE ${table} (${simple}) ENGINE MergeTree ORDER BY id`,
        });
      }
      try {
        await insert(native, nativeTable);
        await insert(http, httpTable);
        expect(await contents(nativeTable)).toEqual(await contents(httpTable));
        expect((await contents(nativeTable)).length).toBeGreaterThan(0);
      } finally {
        await dropTables(nativeTable, httpTable);
      }
    }

    it("JSONCompactEachRow", () =>
      compare((c, table) =>
        c.insert({
          table,
          format: "JSONCompactEachRow",
          values: [
            [1, "a", null, 5],
            [2, "b", 1.5, 6],
          ],
        }),
      ));

    it("JSONCompactEachRowWithNames with a column subset", () =>
      compare((c, table) =>
        c.insert({
          table,
          format: "JSONCompactEachRowWithNames",
          values: [
            ["s", "id"],
            ["a", 1],
            ["b", 2],
          ],
          columns: ["id", "s"],
        }),
      ));

    it("JSONObjectEachRow", () =>
      compare((c, table) =>
        c.insert({
          table,
          format: "JSONObjectEachRow",
          values: { r1: { id: 1, s: "a" }, r2: { id: 2, n: 2.5 } },
        }),
      ));

    it("JSON with meta and data", () =>
      compare((c, table) =>
        c.insert({
          table,
          format: "JSON",
          values: {
            meta: [
              { name: "id", type: "UInt64" },
              { name: "s", type: "String" },
            ],
            data: [
              { id: 1, s: "x" },
              { id: 2, s: "y" },
            ],
          },
        }),
      ));

    it("JSONStringsEachRow", () =>
      compare((c, table) =>
        c.insert({
          table,
          format: "JSONStringsEachRow",
          values: [{ id: "1", s: "a", n: "2.5" }],
        }),
      ));

    it("an object-mode stream with DEFAULT columns left out", () =>
      compare((c, table) =>
        c.insert({
          table,
          format: "JSONEachRow",
          values: Stream.Readable.from(
            Array.from({ length: 40000 }, (_, i) =>
              i < 20000 ? { id: i } : { id: i, s: `late ${i}` },
            ),
          ),
        }),
      ));

    it("CSV and TabSeparated streams", async () => {
      await compare((c, table) =>
        c.insert({
          table,
          format: "CSV",
          values: Stream.Readable.from(
            [Buffer.from('1,"a,b",\\N,7\n2,"x",1.5,8\n')],
            { objectMode: false },
          ),
        }),
      );
      await compare((c, table) =>
        c.insert({
          table,
          format: "TabSeparated",
          values: Stream.Readable.from([Buffer.from("1\ta\\tb\t\\N\t7\n")], {
            objectMode: false,
          }),
        }),
      );
    });

    it("rejects a value that does not fit the column", async () => {
      const table = uniqueName("native_bad");
      await http.command({
        query: `CREATE TABLE ${table} (${simple}) ENGINE MergeTree ORDER BY id`,
      });
      try {
        await expect(
          native.insert({
            table,
            format: "JSONEachRow",
            values: [{ id: -1, s: "x" }],
          }),
        ).rejects.toThrow(
          "Cannot insert the value -1 into a column of type UInt64: out of range",
        );
        await expect(
          native.insert({
            table,
            format: "JSONEachRow",
            values: [{ id: 1, nope: 1 }],
            // With the default (1), the client does not send the field, as
            // the server skips it over HTTP.
            clickhouse_settings: { input_format_skip_unknown_fields: 0 },
          }),
        ).rejects.toThrow("No such column nope");
        expect(await contents(table)).toEqual([]);
        // The client can run the next request.
        await native.insert({
          table,
          format: "JSONEachRow",
          values: [{ id: 1 }],
        });
        expect(await contents(table)).toEqual([
          { id: 1, s: "", n: null, d: 10 },
        ]);
      } finally {
        await dropTables(table);
      }
    });
  });

  describe("exec", () => {
    let native: ClickHouseClient;
    beforeAll(() => {
      native = createClient({ url: nativeURL() });
    });
    afterAll(async () => {
      await native.close();
    });

    async function text(stream: Stream.Readable): Promise<string> {
      let out = "";
      for await (const chunk of stream) out += chunk;
      return out;
    }

    it("gives the same results as the HTTP client", async () => {
      for (const query of [
        "SELECT number, 'a' AS s FROM numbers(3) FORMAT CSVWithNames",
        "SELECT number FROM numbers(3)",
        "SELECT number FROM numbers(3) FORMAT JSONEachRow;",
        "SELECT 1 AS x FORMAT JSON",
      ]) {
        const [n, h] = await Promise.all([
          native.exec({ query }).then((r) => text(r.stream)),
          http.exec({ query }).then((r) => text(r.stream)),
        ]);
        if (query.endsWith("FORMAT JSON")) {
          const { statistics: _n, ...nativeDoc } = JSON.parse(n);
          const { statistics: _h, ...httpDoc } = JSON.parse(h);
          expect(nativeDoc).toEqual(httpDoc);
        } else {
          expect(n).toEqual(h);
        }
      }
    });

    it("runs statements and inserts with data", async () => {
      const table = uniqueName("native_exec");
      const created = await native.exec({
        query: `CREATE TABLE ${table} (a UInt8, b String) ENGINE Memory`,
      });
      expect(await text(created.stream)).toBe("");
      try {
        await native.exec({
          query: `INSERT INTO ${table} FORMAT CSV`,
          values: Stream.Readable.from([Buffer.from("1,x\n2,y\n")], {
            objectMode: false,
          }),
        });
        const r = await native.exec({
          query: `SELECT * FROM ${table} ORDER BY a FORMAT TabSeparated`,
        });
        expect(await text(r.stream)).toBe("1\tx\n2\ty\n");
      } finally {
        await native.command({ query: `DROP TABLE ${table}` });
      }
    });

    it("returns the error text with ignore_error_response", async () => {
      const r = await native.exec({
        query: "SELECT * FROM table_that_does_not_exist",
        ignore_error_response: true,
      });
      expect(await text(r.stream)).toMatch(
        /^Code: 60\. DB::Exception: .*\(UNKNOWN_TABLE\)\n$/s,
      );
      await expect(
        native.exec({ query: "SELECT * FROM table_that_does_not_exist" }),
      ).rejects.toMatchObject({
        type: "UNKNOWN_TABLE",
      });
    });
  });
});
