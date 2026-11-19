import Stream from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient as createHttpClient } from "../../../client-node/src";
import type { ClickHouseClient as HttpClient } from "../../../client-node/src";
import { ClickHouseError, createClient } from "../../src";
import type { ClickHouseClient } from "../../src";
import { isZstdAvailable } from "../../src/compression/frames";
import { httpURL, nativeURL, uniqueName } from "./utils";

type AnyClient = ClickHouseClient | HttpClient;

/** Cases in which the client did not do the same as the HTTP client. */
describe("[Native] regressions", () => {
  let client: ClickHouseClient;
  let http: HttpClient;

  beforeAll(() => {
    client = createClient({ url: nativeURL() });
    http = createHttpClient({ url: httpURL() });
  });

  afterAll(async () => {
    await client.close();
    await http.close();
  });

  async function bytes(c: AnyClient, query: string): Promise<Buffer> {
    const result = await (c as HttpClient).exec({ query });
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  async function rows(
    c: AnyClient,
    query: string,
    clickhouse_settings: Record<string, string | number> = {},
  ): Promise<unknown> {
    const rs = await (c as HttpClient).query({
      query,
      format: "JSONEachRow",
      clickhouse_settings,
    });
    return rs.json();
  }

  describe("result stream", () => {
    // Vitest fails the run on an uncaught exception: before the fix, the
    // error of the server was thrown as one in most of these runs.
    it("gives a server error after the first rows to the reader of the stream", async () => {
      for (let i = 0; i < 30; i++) {
        const result = await client
          .query({
            query:
              "SELECT throwIf(number = 70000, 'boom') AS x FROM numbers(100000) SETTINGS max_block_size = 65000",
            format: "JSONEachRow",
          })
          .catch((err: unknown) => err);
        const err =
          result instanceof Error
            ? result
            : await (result as { text(): Promise<string> })
                .text()
                .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ClickHouseError);
        expect((err as Error).message).toContain("boom");
      }
      expect(await rows(client, "SELECT 1 AS x")).toEqual([{ x: 1 }]);
    });

    it("gives the error to a reader that starts later", async () => {
      const rs = await client.query({
        query:
          "SELECT sleepEachRow(0.01) + throwIf(number = 60, 'boom') AS x " +
          "FROM numbers(80) SETTINGS max_block_size = 5, max_threads = 1",
        format: "JSONEachRow",
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      await expect(rs.text()).rejects.toThrow("boom");
    });
  });

  describe("decoder", () => {
    const settings = {
      allow_experimental_dynamic_type: 1,
      allow_experimental_variant_type: 1,
      allow_suspicious_types_in_order_by: 1,
    };

    it.each([
      ["an empty tuple", "SELECT tuple() AS t, 1 AS x"],
      ["an array of empty tuples", "SELECT [tuple(), tuple()] AS a, 'z' AS s"],
      [
        "a tuple element with the name SKIP",
        "SELECT CAST((1, 'x') AS Tuple(SKIP UInt8, b String)) AS t",
      ],
      [
        "an empty tuple in Dynamic",
        "SELECT tuple()::Dynamic AS d, toTypeName(d) AS t",
      ],
    ])("decodes %s", async (_name, query) => {
      expect(await rows(client, query, settings)).toEqual(
        await rows(http, query, settings),
      );
    });

    it("decodes Nullable(Enum) with NULL rows from a JOIN", async () => {
      const table = uniqueName("native_enum");
      await http.command({
        query: `CREATE TABLE ${table} (id UInt64, e Enum8('a' = 1, 'b' = 2)) ENGINE = Memory`,
      });
      try {
        await http.command({ query: `INSERT INTO ${table} VALUES (1, 'b')` });
        const query = `SELECT n.number AS n, t.e AS e FROM numbers(3) AS n LEFT JOIN ${table} AS t ON t.id = n.number ORDER BY n SETTINGS join_use_nulls = 1`;
        const expected = [
          { n: 0, e: null },
          { n: 1, e: "b" },
          { n: 2, e: null },
        ];
        expect(await rows(http, query)).toEqual(expected);
        expect(await rows(client, query)).toEqual(expected);
      } finally {
        await http.command({ query: `DROP TABLE ${table}` });
      }
    });

    it.each([254, 255, 256])(
      "decodes a Dynamic column with %i types",
      async (count) => {
        const values: string[] = [];
        for (let i = 1; i <= count; i++) {
          values.push(`toFixedString('a', ${i})::Dynamic`);
        }
        const query = `SELECT count() AS c, countIf(d IS NULL) AS nulls, uniqExact(dynamicType(d)) AS types FROM (SELECT arrayJoin([${values.join(", ")}, NULL::Dynamic]) AS d)`;
        const inner = `SELECT dynamicType(d) AS t, toString(d) AS s FROM (SELECT arrayJoin([${values.join(", ")}, NULL::Dynamic]) AS d)`;
        expect(await rows(client, query, settings)).toEqual(
          await rows(http, query, settings),
        );
        // The Dynamic values themselves come to the client.
        const dynamic = `SELECT d FROM (SELECT arrayJoin([${values.join(", ")}, NULL::Dynamic]) AS d)`;
        expect(await rows(client, dynamic, settings)).toEqual(
          await rows(http, dynamic, settings),
        );
        expect(await rows(client, inner, settings)).toEqual(
          await rows(http, inner, settings),
        );
      },
    );
  });

  describe("strings with bytes that are not UTF-8", () => {
    const select =
      "SELECT unhex('FF41C3') AS s, MD5('a') AS h, toFixedString(unhex('FE'), 2) AS f, " +
      "[unhex('80'), 'é'] AS a, map(unhex('C0'), unhex('F0908080')) AS m, " +
      "toLowCardinality(unhex('ED')) AS lc, 'ok \\t é ✓' AS t";

    it.each(["TabSeparated", "TabSeparatedRaw", "CSV", "JSONEachRow"])(
      "writes the same bytes as HTTP in %s",
      async (format) => {
        const query = `${select} FORMAT ${format}`;
        const expected = await bytes(http, query);
        expect(expected.includes(0xff)).toBe(true);
        expect((await bytes(client, query)).toString("hex")).toBe(
          expected.toString("hex"),
        );
      },
    );

    it("writes the same bytes for totals and extremes", async () => {
      const query =
        "SELECT unhex('FF') AS s, count() AS c FROM numbers(3) GROUP BY s WITH TOTALS SETTINGS extremes = 1 FORMAT TabSeparated";
      expect((await bytes(client, query)).toString("hex")).toBe(
        (await bytes(http, query)).toString("hex"),
      );
    });

    it("keeps valid text of the other rows", async () => {
      const query =
        "SELECT if(number = 2, unhex('FF'), 'é😀') AS s FROM numbers(4) FORMAT TabSeparated";
      expect((await bytes(client, query)).toString("hex")).toBe(
        (await bytes(http, query)).toString("hex"),
      );
    });
  });

  describe("settings in the SQL text", () => {
    it("uses the output settings of a SETTINGS clause", async () => {
      const query =
        "SELECT toUInt64(1) AS u, nan AS n SETTINGS output_format_json_quote_64bit_integers = 1, output_format_json_quote_denormals = 1";
      const expected = [{ u: "1", n: "nan" }];
      expect(await rows(http, query)).toEqual(expected);
      expect(await rows(client, query)).toEqual(expected);
    });

    it("uses session_timezone of a SETTINGS clause", async () => {
      const query =
        "SELECT toDateTime(1700000000) AS d SETTINGS session_timezone = 'Asia/Tokyo'";
      expect(await rows(client, query)).toEqual(await rows(http, query));
    });
  });

  describe("DateTime64 text without zeros at the end", () => {
    const select =
      "SELECT toDateTime64('2024-01-01 00:00:00.1', 1, 'UTC') AS a, toDateTime64('2024-01-01 00:00:00.120', 6, 'UTC') AS c, " +
      "toDateTime64('2024-01-01 00:00:00.1234', 6, 'UTC') AS d, toDateTime64('2024-01-01 00:00:00.000001', 9, 'UTC') AS e, " +
      "toDateTime64('2024-01-01 00:00:00', 6, 'UTC') AS f, toDateTime64('1969-12-31 23:59:59.5', 4, 'UTC') AS i, " +
      "toDateTime64('2024-01-01 00:00:00.10', 4, 'Asia/Tokyo') AS j, [toDateTime64('2024-01-01 00:00:00.5', 3, 'UTC')] AS arr, " +
      "toDateTime64('2024-01-01 00:00:00', 0, 'UTC') AS h";
    const setting =
      "date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands = 1";

    it.each(["simple", "iso"])(
      "writes the same bytes as HTTP with date_time_output_format = %s",
      async (format) => {
        for (const output of ["TabSeparated", "JSONEachRow", "CSV"]) {
          const query = `${select} SETTINGS ${setting}, date_time_output_format = '${format}' FORMAT ${output}`;
          expect((await bytes(client, query)).toString()).toBe(
            (await bytes(http, query)).toString(),
          );
        }
      },
    );

    it("uses the setting of the request", async () => {
      const settings = {
        date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands: 1,
      };
      const expected = await rows(http, select, settings);
      expect(expected).toMatchObject([
        { c: "2024-01-01 00:00:00.120", f: "2024-01-01 00:00:00" },
      ]);
      expect(await rows(client, select, settings)).toEqual(expected);
    });
  });

  describe("large blocks", () => {
    const query =
      "SELECT number, repeat(toString(number), 60) AS s, [number, number + 1] AS a FROM numbers(40000) SETTINGS max_block_size = 40000";
    let expected: string;

    beforeAll(async () => {
      const rs = await http.query({ query, format: "JSONEachRow" });
      expected = await rs.text();
    });

    // zlib has zstd from Node.js 22.15.
    const methods = isZstdAvailable()
      ? (["none", "lz4", "zstd"] as const)
      : (["none", "lz4"] as const);
    it.each(methods)(
      "reads one large block with compression %s",
      async (compression) => {
        const c = createClient({ url: nativeURL(), compression });
        try {
          const rs = await c.query({ query, format: "JSONEachRow" });
          const text = await rs.text();
          expect(text.length).toBe(expected.length);
          expect(text === expected).toBe(true);
        } finally {
          await c.close();
        }
      },
    );
  });

  describe("binary JSON rows", () => {
    const query = `SELECT
      if(number = 0, toUInt64('18446744073709551615'), number) AS u64,
      multiIf(number = 0, toInt64('-9223372036854775808'),
              number = 1, toInt64('9223372036854775807'),
              number = 2, toInt64('-9007199254740993'),
              toInt64(number) - 1000) AS i64,
      if(number = 0, toUInt32(4294967295), toUInt32(number)) AS u32,
      toInt16(toInt64(number) - 1000) AS i16,
      toInt8(toInt64(number % 256) - 128) AS i8,
      toBool(number % 2) AS b,
      concat(unhex('00070A0D09225C2F7F'), toString(number)) AS \`s/é\`,
      concat(unhex('C3A9F09F9880E280A8E280A9'), toString(number)) AS unicode
      FROM numbers(2000)`;

    it.each([
      { format: "JSONEachRow", compression: "none", quote: 1, slash: 1 },
      {
        format: "JSONCompactEachRowWithNamesAndTypes",
        compression: "lz4",
        quote: 0,
        slash: 0,
      },
    ] as const)(
      "matches HTTP in $format with compression $compression",
      async ({ format, compression, quote, slash }) => {
        const native = createClient({
          url: nativeURL(),
          compression,
          max_open_connections: 1,
        });
        const params = {
          query,
          format,
          clickhouse_settings: {
            max_block_size: "127",
            output_format_json_quote_64bit_integers: quote,
            output_format_json_escape_forward_slashes: slash,
          },
        };
        try {
          expect(await (await native.query(params)).text()).toBe(
            await (await http.query(params)).text(),
          );
          expect(await (await native.query(params)).json()).toEqual(
            await (await http.query(params)).json(),
          );
        } finally {
          await native.close();
        }
      },
    );
  });

  describe("connection pool", () => {
    it("rejects a request that waits for a connection when its signal aborts", async () => {
      const c = createClient({ url: nativeURL(), max_open_connections: 1 });
      try {
        const slow = c
          .query({ query: "SELECT sleep(0.5) AS s", format: "JSONEachRow" })
          .then((rs) => rs.json());
        await new Promise((resolve) => setTimeout(resolve, 50));
        const controller = new AbortController();
        const waiting = c.query({
          query: "SELECT 1",
          abort_signal: controller.signal,
        });
        controller.abort();
        await expect(waiting).rejects.toThrow("The user aborted a request.");
        expect(await slow).toEqual([{ s: 0 }]);
        const aborted = new AbortController();
        aborted.abort();
        await expect(
          c.query({ query: "SELECT 1", abort_signal: aborted.signal }),
        ).rejects.toThrow("The user aborted a request.");
        expect(await rows(c, "SELECT 2 AS x")).toEqual([{ x: 2 }]);
      } finally {
        await c.close();
      }
    });

    it("gives the socket back when the signal aborts as the pool hands it over", async () => {
      const c = createClient({ url: nativeURL(), max_open_connections: 1 });
      // The pool of the client, to abort right after it hands over a socket.
      const pool = (c as unknown as { connection: Record<string, unknown> })
        .connection as {
        release: (socket: unknown) => void;
        idle: unknown[];
        open: number;
      };
      try {
        const slow = c
          .query({ query: "SELECT sleep(0.3) AS s", format: "JSONEachRow" })
          .then((rs) => rs.json());
        await new Promise((resolve) => setTimeout(resolve, 50));
        const controller = new AbortController();
        const waiting = c.query({
          query: "SELECT 1",
          abort_signal: controller.signal,
        });
        const release = pool.release.bind(pool);
        let handedOver = false;
        pool.release = (socket) => {
          release(socket);
          if (!handedOver) {
            handedOver = true;
            // The waiting request has the socket, but has not run yet.
            controller.abort();
          }
        };
        await expect(waiting).rejects.toThrow("The user aborted a request.");
        expect(await slow).toEqual([{ s: 0 }]);
        expect(pool.open).toBe(1);
        expect(pool.idle).toHaveLength(1);
        expect(await rows(c, "SELECT 2 AS x")).toEqual([{ x: 2 }]);
      } finally {
        await c.close();
      }
    });

    it("rejects the options of the HTTP interface before it uses a connection", async () => {
      await expect(
        client.query({ query: "SELECT 1", session_id: "s" }),
      ).rejects.toThrow("session_id is not supported");
      await expect(
        client.command({ query: "SELECT 1", role: "r" }),
      ).rejects.toThrow("role is not supported");
    });
  });

  describe("insert", () => {
    const BATCH = 16_384;

    /**
     * Makes a table, runs the insert with the HTTP client and with the
     * native client, and returns what the server stored for each of them.
     */
    async function stored(
      columns: string,
      insert: (c: AnyClient, table: string) => Promise<unknown>,
      select = "SELECT * FROM {table} ORDER BY ALL",
      engine = "MergeTree ORDER BY tuple()",
    ): Promise<{ http: string; native: string }> {
      const result = { http: "", native: "" };
      for (const [name, c] of [
        ["http", http],
        ["native", client],
      ] as const) {
        const table = uniqueName(`native_regress_${name}`);
        await http.command({
          query: `CREATE TABLE ${table} (${columns}) ENGINE = ${engine}`,
        });
        try {
          let outcome: string;
          try {
            await insert(c, table);
            const rs = await http.query({
              query: select.replace("{table}", table),
              format: "JSONCompactEachRow",
            });
            outcome = await rs.text();
          } catch (err) {
            outcome = `error ${(err as { code?: string }).code ?? (err as Error).message}`;
          }
          result[name] = outcome;
        } finally {
          await http.command({ query: `DROP TABLE ${table}` });
        }
      }
      return result;
    }

    const objects = (make: () => AsyncGenerator<unknown>) =>
      Stream.Readable.from(make(), { objectMode: true });

    it("uses the DEFAULT expression when a later batch leaves out the column", async () => {
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42, w String DEFAULT concat('w', toString(id))",
        (c, table) =>
          (c as HttpClient).insert({
            table,
            format: "JSONEachRow",
            values: objects(async function* () {
              for (let i = 0; i < BATCH; i++) yield { id: i, v: 7, w: "x" };
              for (let i = BATCH; i < BATCH + 5; i++) yield { id: i };
              for (let i = BATCH + 5; i < 2 * BATCH + 5; i++) {
                yield { id: i, v: 8 };
              }
            }),
          }),
        "SELECT v, w = concat('w', toString(id)) AS dw, count() FROM {table} GROUP BY v, dw ORDER BY v, dw",
      );
      expect(result.native).toBe(result.http);
      expect(result.http).toContain("[42, 1, 5]");
    });

    it("uses the DEFAULT expression with an explicit column list", async () => {
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42, s String",
        (c, table) =>
          (c as HttpClient).insert({
            table,
            format: "JSONEachRow",
            columns: ["id", "v"],
            values: [{ id: 1 }, { id: 2 }],
          }),
      );
      expect(result.native).toBe(result.http);
      expect(result.http).toContain('[1, 42, ""]');
    });

    it("uses the type default for omitted fields when expression defaults are disabled", async () => {
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42",
        (c, table) =>
          (c as HttpClient).insert({
            table,
            format: "JSONEachRow",
            values: [{ id: 1 }],
            clickhouse_settings: {
              input_format_defaults_for_omitted_fields: 0,
            },
          }),
      );
      expect(result.http).toBe("[1, 0]\n");
      expect(result.native).toBe(result.http);
    });

    it("honors a custom serializer for array and streamed rows", async () => {
      const table = uniqueName("native_custom_serializer");
      const custom = createClient({
        url: nativeURL(),
        json: {
          stringify: (value: { id: number; v: number }) => {
            if (value.id === 3) throw new Error("Cannot serialize row 3");
            return JSON.stringify({ ...value, v: 19 });
          },
        },
      });
      try {
        await http.command({
          query: `CREATE TABLE ${table} (id UInt32, v UInt32) ENGINE Memory`,
        });
        await custom.insert({
          table,
          format: "JSONEachRow",
          values: [{ id: 1, v: 7 }],
        });
        await custom.insert({
          table,
          format: "JSONEachRow",
          values: Stream.Readable.from([{ id: 2, v: 7 }]),
        });
        await expect(
          custom.insert({
            table,
            format: "JSONEachRow",
            values: Stream.Readable.from([{ id: 3, v: 7 }]),
          }),
        ).rejects.toThrow("Cannot serialize row 3");
        expect(
          await rows(http, `SELECT id, v FROM ${table} ORDER BY id`),
        ).toEqual([
          { id: 1, v: 19 },
          { id: 2, v: 19 },
        ]);
      } finally {
        await custom.close();
        await http.command({ query: `DROP TABLE IF EXISTS ${table}` });
      }
    });

    it.each([false, true])(
      "cancels an insert waiting for input and frees the pool slot (custom serialization: %s)",
      async (custom) => {
        const c = createClient({
          url: nativeURL(),
          max_open_connections: 1,
          ...(custom
            ? { json: { stringify: (value: unknown) => JSON.stringify(value) } }
            : {}),
        });
        const controller = new AbortController();
        const started = Promise.withResolvers<void>();
        const source = new Stream.Readable({
          objectMode: true,
          read: () => started.resolve(),
        });
        try {
          const request = c.insert({
            table: "unused_before_the_first_batch",
            values: source,
            format: "JSONEachRow",
            abort_signal: controller.signal,
          });
          const rejected = expect(request).rejects.toThrow(
            "The user aborted a request.",
          );
          await started.promise;
          const closed = new Promise<void>((resolve) =>
            source.once("close", resolve),
          );
          controller.abort();
          await rejected;
          await closed;
          expect(source.destroyed).toBe(true);
          expect(await c.ping()).toEqual({ success: true });
        } finally {
          source.destroy();
          await c.close();
        }
      },
    );

    it("keeps all rows with a deduplication token when the fields change", async () => {
      const insert = (c: AnyClient, table: string) =>
        (c as HttpClient).insert({
          table,
          format: "JSONEachRow",
          clickhouse_settings: { insert_deduplication_token: "token-1" },
          values: objects(async function* () {
            for (let i = 0; i < BATCH; i++) yield { id: i, a: 1 };
            for (let i = BATCH; i < 2 * BATCH; i++) yield { id: i, a: 1, b: 2 };
          }),
        });
      const result = await stored(
        "id UInt32, a UInt32, b UInt32",
        async (c, table) => {
          await insert(c, table);
          // The same data with the same token is a duplicate.
          await insert(c, table);
        },
        "SELECT count(), sum(b) FROM {table}",
        "MergeTree ORDER BY id SETTINGS non_replicated_deduplication_window = 100",
      );
      expect(result.http).toBe(`[${2 * BATCH}, ${2 * BATCH}]\n`);
      expect(result.native).toBe(result.http);
    });

    it("skips the fields that are not columns, as the server does", async () => {
      const values = [
        { id: 1, extra: "x", v: 5 },
        { id: 2, other: [1] },
      ];
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42",
        (c, table) =>
          (c as HttpClient).insert({ table, format: "JSONEachRow", values }),
      );
      expect(result.http).toBe("[1, 5]\n[2, 42]\n");
      expect(result.native).toBe(result.http);
    });

    it("skips unknown fields in a later batch", async () => {
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42",
        (c, table) =>
          (c as HttpClient).insert({
            table,
            format: "JSONEachRow",
            values: objects(async function* () {
              for (let i = 0; i < BATCH; i++) yield { id: i, v: 1 };
              for (let i = BATCH; i < BATCH + 3; i++) {
                yield { id: i, v: 2, extra: i };
              }
            }),
          }),
        "SELECT v, count() FROM {table} GROUP BY v ORDER BY v",
      );
      expect(result.http).toBe(`[1, ${BATCH}]\n[2, 3]\n`);
      expect(result.native).toBe(result.http);
    });

    it("rejects unknown fields when the setting is off", async () => {
      for (const columns of [undefined, ["id", "v"]]) {
        const result = await stored("id UInt32, v UInt32", (c, table) =>
          (c as HttpClient).insert({
            table,
            format: "JSONEachRow",
            columns: columns as [string, ...string[]] | undefined,
            values: [{ id: 1, v: 2, extra: "x" }],
            clickhouse_settings: { input_format_skip_unknown_fields: 0 },
          }),
        );
        expect(result.http).toMatch(/^error /);
        expect(result.native).toMatch(/^error /);
      }
    });

    it("uses the default for null in a column that is not Nullable", async () => {
      const values = [
        { id: 1, v: null, s: null, n: null, a: [1, null], t: { x: null } },
        { id: 2, v: 3, s: "s", n: 4, a: [], t: { x: 9 } },
      ];
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42, s String DEFAULT 'dflt', n UInt8, a Array(UInt8), t Tuple(x UInt8)",
        (c, table) =>
          (c as HttpClient).insert({ table, format: "JSONEachRow", values }),
      );
      expect(result.http).toContain('[1, 42, "dflt", 0, [1,0], {"x":0}]');
      expect(result.native).toBe(result.http);
    });

    it("uses the server's NULL input rules when input_format_null_as_default is off", async () => {
      const result = await stored("id UInt32, n UInt8", (c, table) =>
        (c as HttpClient).insert({
          table,
          format: "JSONEachRow",
          values: [{ id: 1, n: null }],
          clickhouse_settings: { input_format_null_as_default: 0 },
        }),
      );
      expect(result.http).toMatch(/^(?:error |\[1, 0\]\n)/);
      expect(result.native).toBe(result.http);
    });

    it("inserts the text of Array, Map and Tuple values with the JSONStrings formats", async () => {
      const columns =
        "id UInt32, a Array(String), m Map(String, UInt8), t Tuple(x UInt8, y String), d DateTime64(3, 'UTC'), v UInt32 DEFAULT 42";
      const objectsResult = await stored(columns, (c, table) =>
        (c as HttpClient).insert({
          table,
          format: "JSONStringsEachRow",
          values: [
            {
              id: "2",
              a: "['p','q']",
              m: "{'k':2}",
              t: "(3,'z')",
              d: "2024-01-02 00:00:00.5",
            },
          ],
        }),
      );
      expect(objectsResult.http).toContain('["p","q"]');
      expect(objectsResult.native).toBe(objectsResult.http);
      const compactResult = await stored(columns, (c, table) =>
        (c as HttpClient).insert({
          table,
          format: "JSONCompactStringsEachRowWithNames",
          values: [
            ["id", "t", "a"],
            ["3", "(4,'w')", "[]"],
            ["4", "(5,'v')", "['r']"],
          ],
        }),
      );
      expect(compactResult.http).toContain('[3, [], {}, {"x":4,"y":"w"}');
      expect(compactResult.native).toBe(compactResult.http);
    });

    it("uses DEFAULT expressions for JSONCompactEachRowWithNames with a column subset", async () => {
      const columns = "id UInt32, v UInt32 DEFAULT 42, s String DEFAULT 'd'";
      const values = [
        ["s", "id"],
        ["x", 1],
        ["y", 2],
      ];
      const result = await stored(columns, (c, table) =>
        (c as HttpClient).insert({
          table,
          format: "JSONCompactEachRowWithNames",
          values,
        }),
      );
      expect(result.http).toBe('[1, 42, "x"]\n[2, 42, "y"]\n');
      expect(result.native).toBe(result.http);
      const listed = await stored(columns, (c, table) =>
        (c as HttpClient).insert({
          table,
          format: "JSONCompactEachRowWithNames",
          columns: ["id", "v", "s"],
          values,
        }),
      );
      expect(listed.http).toBe('[1, 42, "x"]\n[2, 42, "y"]\n');
      expect(listed.native).toBe(listed.http);
    });

    it("uses the default for null in JSONCompactEachRow", async () => {
      const result = await stored(
        "id UInt32, v UInt32 DEFAULT 42, n UInt8",
        (c, table) =>
          (c as HttpClient).insert({
            table,
            format: "JSONCompactEachRow",
            values: [
              [1, null, null],
              [2, 3, 4],
            ],
          }),
      );
      expect(result.http).toBe("[1, 42, 0]\n[2, 3, 4]\n");
      expect(result.native).toBe(result.http);
    });

    describe("strings in a Dynamic column", () => {
      const values: unknown[] = [
        "2024-01-02",
        "2024-1-2",
        "2024-02-30",
        "2149-06-07",
        "2024-01-02 03:04:05",
        "2024-01-02T03:04:05.123Z",
        "2024-01-02 03:04:05+02:00",
        "1969-12-31 23:59:59",
        "Jan 2 2024",
        "01/02/2024",
        "24-01-02",
        "2024-13-01",
        "20240102",
        "1700000000.5",
        "v1.2.3",
        "abc",
        "",
        5,
        ["2024-01-02", "2024-01-03"],
        ["2024-01-02", "x"],
        ["2024-01-02", null],
        { d: "2024-01-02", t: "2024-01-02 03:04:05", s: "x" },
        [{ d: "2024-01-02" }, { d: "x" }],
      ];
      const columns =
        "id UInt32, y Dynamic(max_types = 100), v UInt32 DEFAULT 42";
      const select =
        "SELECT id, dynamicType(y), toString(y), v FROM {table} ORDER BY id";
      const base = { allow_experimental_dynamic_type: 1 };

      it("stores the types that the server finds", async () => {
        const result = await stored(
          columns,
          (c, table) =>
            (c as HttpClient).insert({
              table,
              format: "JSONEachRow",
              values: values.map((y, id) => ({ id, y })),
              clickhouse_settings: base,
            }),
          select,
        );
        expect(result.http).toContain('[0, "Date", "2024-01-02", 42]');
        expect(result.http).toContain('"DateTime64(9)"');
        expect(result.http).toContain('"Array(Date)"');
        expect(result.native).toBe(result.http);
      });

      it("stores the types of each batch", async () => {
        const result = await stored(
          columns,
          (c, table) =>
            (c as HttpClient).insert({
              table,
              format: "JSONEachRow",
              clickhouse_settings: base,
              values: objects(async function* () {
                for (let id = 0; id < BATCH; id++) yield { id, y: "text" };
                for (let id = BATCH; id < BATCH + 3; id++) {
                  yield { id, y: "2024-01-02" };
                }
                for (let id = BATCH + 3; id < 2 * BATCH; id++) {
                  yield { id, y: id };
                }
              }),
            }),
          "SELECT dynamicType(y), count(), sum(v) FROM {table} GROUP BY 1 ORDER BY 1",
        );
        expect(result.http).toContain('["Date", 3, 126]');
        expect(result.native).toBe(result.http);
      });

      it.each([
        [{ input_format_try_infer_dates: 0 }],
        [{ input_format_try_infer_datetimes: 0 }],
        [
          {
            input_format_try_infer_dates: 0,
            input_format_try_infer_datetimes: 0,
          },
        ],
      ])("follows %o", async (clickhouse_settings) => {
        const result = await stored(
          columns,
          (c, table) =>
            (c as HttpClient).insert({
              table,
              format: "JSONEachRow",
              values: values.map((y, id) => ({ id, y })),
              clickhouse_settings: { ...base, ...clickhouse_settings },
            }),
          select,
        );
        expect(result.native).toBe(result.http);
      });
    });

    it("can run the next request after a server error in an insert", async () => {
      const c = createClient({ url: nativeURL(), max_open_connections: 1 });
      const table = uniqueName("native_regress_check");
      await http.command({
        query: `CREATE TABLE ${table} (id UInt32, CONSTRAINT small CHECK id < 1000000) ENGINE = MergeTree ORDER BY id`,
      });
      try {
        await expect(
          c.insert({
            table,
            format: "JSONEachRow",
            values: objects(async function* () {
              for (let i = 0; i < BATCH; i++) {
                yield { id: i === 5 ? 2_000_000 : i };
              }
              await new Promise((resolve) => setTimeout(resolve, 300));
              for (let i = 0; i < BATCH; i++) yield { id: i };
            }),
          }),
        ).rejects.toThrow(/Constraint/);
        expect(await rows(c, "SELECT 1 AS x")).toEqual([{ x: 1 }]);
      } finally {
        await c.close();
        await http.command({ query: `DROP TABLE ${table}` });
      }
    });
  });
});
