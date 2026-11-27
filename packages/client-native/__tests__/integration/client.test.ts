import net from "node:net";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BinaryWriter } from "../../src/protocol/binary";
import { ClickHouseError, createClient } from "../../src";
import type { ClickHouseClient } from "../../src";
import { nativeURL, uniqueName } from "./utils";

describe("[Native] client", () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createClient({ url: nativeURL() });
  });
  afterEach(async () => {
    await client.close();
  });

  describe("query", () => {
    it("returns rows in the JSON format by default", async () => {
      const rs = await client.query({ query: "SELECT 1 AS x" });
      const json = await rs.json();
      expect(json.data).toEqual([{ x: 1 }]);
      expect(json.meta).toEqual([{ name: "x", type: "UInt8" }]);
      expect(json.rows).toBe(1);
      expect(json.statistics?.rows_read).toBe(1);
    });

    it("uses the query_id of the caller", async () => {
      const query_id = uniqueName("native_query_id");
      const rs = await client.query({
        query: "SELECT queryID() AS id",
        format: "JSONEachRow",
        query_id,
      });
      expect(rs.query_id).toBe(query_id);
      expect(await rs.json()).toEqual([{ id: query_id }]);
    });

    it("binds query parameters", async () => {
      const rs = await client.query({
        query:
          "SELECT {s:String} AS s, {a:Array(UInt32)} AS a, {n:Nullable(String)} AS n, {d:DateTime} AS d",
        format: "JSONEachRow",
        query_params: {
          s: "it's a \\ test\twith tab",
          a: [1, 2],
          n: null,
          d: new Date(Date.UTC(2024, 0, 1, 12, 0, 0)),
        },
        clickhouse_settings: { session_timezone: "UTC" },
      });
      expect(await rs.json()).toEqual([
        {
          s: "it's a \\ test\twith tab",
          a: [1, 2],
          n: null,
          d: "2024-01-01 12:00:00",
        },
      ]);
    });

    it("streams the rows of many blocks", async () => {
      const rs = await client.query({
        query: "SELECT number FROM numbers(100000)",
        format: "JSONCompactEachRow",
        clickhouse_settings: { max_block_size: "4096" },
      });
      let count = 0;
      let sum = 0;
      for await (const rows of rs.stream()) {
        for (const row of rows) {
          count++;
          sum += (row.json() as number[])[0] as number;
        }
      }
      expect(count).toBe(100000);
      expect(sum).toBe((99999 * 100000) / 2);
    });

    it("throws a ClickHouseError with code and type", async () => {
      const err = await client
        .query({ query: "SELECT * FROM table_that_does_not_exist" })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ClickHouseError);
      expect(err).toMatchObject({ code: "60", type: "UNKNOWN_TABLE" });
      expect((err as Error).message).toContain("table_that_does_not_exist");
    });

    it("rejects an unknown setting", async () => {
      const err = await client
        .query({
          query: "SELECT 1",
          clickhouse_settings: { no_such_setting: 1 } as any,
        })
        .catch((e: unknown) => e);
      expect(err).toMatchObject({ code: "115", type: "UNKNOWN_SETTING" });
    });

    it("fails the stream when the server fails during the result", async () => {
      const rs = await client.query({
        query: "SELECT throwIf(number = 50000, 'boom') FROM numbers(100000)",
        format: "JSONEachRow",
        clickhouse_settings: { max_block_size: "1000" },
      });
      const err = await rs.json().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ClickHouseError);
      expect((err as Error).message).toContain("boom");
      // The connection can run the next query.
      const next = await client.query({
        query: "SELECT 2 AS x",
        format: "JSONEachRow",
      });
      expect(await next.json()).toEqual([{ x: 2 }]);
    });

    it("can close the result before the end", async () => {
      const rs = await client.query({
        query: "SELECT number FROM numbers(10000000)",
        format: "JSONEachRow",
      });
      const stream = rs.stream();
      for await (const _rows of stream) {
        break;
      }
      rs.close();
      const next = await client.query({
        query: "SELECT 3 AS x",
        format: "JSONEachRow",
      });
      expect(await next.json()).toEqual([{ x: 3 }]);
    });

    it("can be aborted", async () => {
      const controller = new AbortController();
      const promise = client.query({
        query: "SELECT sleep(3)",
        format: "JSONEachRow",
        abort_signal: controller.signal,
      });
      setTimeout(() => controller.abort(), 100);
      await expect(promise).rejects.toThrow("The user aborted a request.");
      const next = await client.query({
        query: "SELECT 4 AS x",
        format: "JSONEachRow",
      });
      expect(await next.json()).toEqual([{ x: 4 }]);
    });

    it("rejects a column type that the client cannot decode", async () => {
      await expect(
        client.query({
          query: "SELECT uniqState(1) AS s",
          format: "JSONEachRow",
        }),
      ).rejects.toThrow(
        "The client cannot decode columns of type AggregateFunction(uniq, UInt8)",
      );
      const next = await client.query({
        query: "SELECT 5 AS x",
        format: "JSONEachRow",
      });
      expect(await next.json()).toEqual([{ x: 5 }]);
    });

    it("rejects a format that the client cannot write", async () => {
      await expect(
        client.query({ query: "SELECT 1", format: "Parquet" }),
      ).rejects.toThrow("The Parquet format is not supported");
    });

    it("rejects a conflicting FORMAT clause and accepts a matching one", async () => {
      await expect(
        client.query({
          query: "SELECT 1 AS n FORMAT CSV; -- note",
          format: "JSONEachRow",
        }),
      ).rejects.toThrow(/CSV.*JSONEachRow/);
      const rs = await client.query({
        query: "SELECT 1 AS n FORMAT JSONEachRow; -- note",
        format: "JSONEachRow",
      });
      expect(await rs.text()).toBe('{"n":1}\n');
    });

    it("honors FORMAT before a trailing SQL comment in exec()", async () => {
      const { stream, response_headers } = await client.exec({
        query: "SELECT 1 AS n format JSONEachRow -- note",
      });
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(Buffer.from(chunk));
      expect(response_headers["x-clickhouse-format"]).toBe("JSONEachRow");
      expect(Buffer.concat(chunks).toString()).toBe('{"n":1}\n');
    });

    it("consumes progress before the first result row", async () => {
      const rs = await client.query({
        query:
          "SELECT sum(number + sleepEachRow(0.02)) AS n FROM numbers(80) " +
          "SETTINGS max_block_size=5, interactive_delay=1000, max_threads=1",
        format: "JSONEachRowWithProgress",
        abort_signal: AbortSignal.timeout(10_000),
      });
      const text = await rs.text();
      const row = text.indexOf('{"row":{"n":');
      expect(row).toBeGreaterThan(0);
      expect(
        text.slice(0, row).match(/\{"progress":/g)?.length,
      ).toBeGreaterThan(1);
    });

    it("closes an active result when the client closes", async () => {
      const rs = await client.query({
        query:
          "SELECT number FROM numbers(1000000) SETTINGS max_block_size=1000",
        format: "JSONEachRow",
      });
      await client.close();
      await expect(rs.text()).rejects.toThrow("The client is closed");
    });

    it("closes a socket that is waiting for the server Hello", async () => {
      const server = net.createServer();
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const connection = once(server, "connection");
      const { port } = server.address() as net.AddressInfo;
      await client.close();
      client = createClient({ url: `tcp://127.0.0.1:${port}` });
      const query = client.query({ query: "SELECT 1" });
      const rejected = expect(query).rejects.toThrow("The client is closed");
      const [peer] = (await connection) as [net.Socket];
      try {
        await once(peer, "data");
        const closed = once(peer, "close");
        await client.close();
        await rejected;
        await closed;
      } finally {
        peer.destroy();
        server.close();
      }
    });

    it("runs queries in parallel with a small pool", async () => {
      await client.close();
      client = createClient({ url: nativeURL(), max_open_connections: 2 });
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) =>
          client
            .query({
              query: `SELECT ${i} AS i, sleep(0.05)`,
              format: "JSONEachRow",
            })
            .then((rs) => rs.json<{ i: number }>()),
        ),
      );
      expect(results.map((r) => r[0]?.i)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      ]);
    });

    it("gives the request_timeout error when the server sends nothing", async () => {
      // A fake server: it answers the handshake and then sends nothing.
      // (A real server sends Progress packets during a long query, so the
      // timeout applies only when no packet comes for request_timeout ms.)
      const server = net.createServer((socket) => {
        socket.once("data", () => {
          socket.write(
            new BinaryWriter()
              .varuint(0) // Hello
              .string("ClickHouse")
              .varuint(26)
              .varuint(1)
              .varuint(54460)
              .string("UTC")
              .string("fake")
              .varuint(1)
              .toBuffer(),
          );
        });
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const { port } = server.address() as net.AddressInfo;
      await client.close();
      client = createClient({
        url: `tcp://127.0.0.1:${port}`,
        request_timeout: 200,
      });
      try {
        await expect(client.query({ query: "SELECT 1" })).rejects.toThrow(
          "Timeout error.",
        );
      } finally {
        server.close();
      }
    });
  });

  describe("command", () => {
    it("runs DDL and inserts with inline data", async () => {
      const table = uniqueName("native_command");
      await client.command({
        query: `CREATE TABLE ${table} (id UInt32, s String) ENGINE MergeTree ORDER BY id`,
      });
      try {
        const insert = await client.command({
          query: `INSERT INTO ${table} VALUES (1, 'a'), (2, 'b')`,
        });
        expect(insert.summary?.written_rows).toBe("2");
        await client.command({
          query: `INSERT INTO ${table} SELECT number + 10, toString(number) FROM numbers(3)`,
        });
        // The server waits for data: the client sends none.
        await client.command({
          query: `INSERT INTO ${table} FORMAT JSONEachRow`,
        });
        await client.command({
          query: `/* comment */ INSERT INTO ${table} (id, s) VALUES ({id:UInt32}, {s:String})`,
          query_params: { id: 20, s: "x" },
        });
        const rs = await client.query({
          query: `SELECT count() AS c FROM ${table}`,
          format: "JSONEachRow",
        });
        expect(await rs.json()).toEqual([{ c: 6 }]);
      } finally {
        await client.command({ query: `DROP TABLE ${table}` });
      }
    });

    it("throws a ClickHouseError", async () => {
      await expect(
        client.command({ query: "DROP TABLE table_that_does_not_exist" }),
      ).rejects.toMatchObject({ type: "UNKNOWN_TABLE" });
    });

    it("can ignore the error", async () => {
      await expect(
        client.command({
          query: "DROP TABLE table_that_does_not_exist",
          ignore_error_response: true,
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("ping", () => {
    it("pings the server", async () => {
      expect(await client.ping()).toEqual({ success: true });
      expect(await client.ping({ select: true })).toEqual({ success: true });
    });

    it("returns the error when the server is not available", async () => {
      const unavailable = createClient({
        url: "tcp://127.0.0.1:1",
        connect_timeout: 1000,
      });
      const result = await unavailable.ping();
      expect(result.success).toBe(false);
      await unavailable.close();
    });
  });

  describe("connection", () => {
    it("reads the user, password and database from the URL", async () => {
      const url = new URL(nativeURL());
      url.username = "default";
      url.pathname = "/system";
      const c = createClient({ url: url.toString() });
      const rs = await c.query({
        query: "SELECT currentDatabase() AS db, currentUser() AS u",
        format: "JSONEachRow",
      });
      expect(await rs.json()).toEqual([{ db: "system", u: "default" }]);
      await c.close();
    });

    it("fails with a wrong password", async () => {
      const c = createClient({ url: nativeURL(), password: "wrong password" });
      await expect(c.query({ query: "SELECT 1" })).rejects.toMatchObject({
        type: "AUTHENTICATION_FAILED",
      });
      await c.close();
    });

    it("accepts only tcp and tcps URLs", () => {
      expect(() => createClient({ url: "http://localhost:8123" })).toThrow(
        "ClickHouse URL protocol must be either tcp or tcps. Got: http:",
      );
    });
  });
});
