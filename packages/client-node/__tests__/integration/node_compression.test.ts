import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  type ClickHouseClient,
  type ResponseJSON,
} from "@clickhouse/client-common";
import { createTestClient, guid } from "@test/utils";
import { createSimpleTable } from "@test/fixtures/simple_table";
import { isClickHouseVersionAtLeast } from "@test/utils/server_version";
import http from "http";
import { type AddressInfo } from "net";
import Zlib from "zlib";

// zstd HTTP transport is supported by the ClickHouse server since 22.10, and the
// client's zstd codec needs the built-in `zlib` zstd APIs (Node.js >= 22.15.0).
const zstdSupported =
  typeof Zlib.createZstdCompress === "function" &&
  typeof Zlib.createZstdDecompress === "function";

describe("[Node.js] Compression", () => {
  describe("Malformed compression response", () => {
    const logAndQuit = (err: Error | unknown, prefix: string) => {
      console.error(prefix, err);
      expect.fail(
        `An unexpected error was propagated to the global context: ${prefix} ${err}`,
      );
    };
    const uncaughtExceptionListener = (err: Error) =>
      logAndQuit(err, "uncaughtException:");
    const unhandledRejectionListener = (err: unknown) =>
      logAndQuit(err, "unhandledRejection:");

    beforeEach(async () => {
      process.on("uncaughtException", uncaughtExceptionListener);
      process.on("unhandledRejection", unhandledRejectionListener);
    });
    afterEach(async () => {
      process.off("uncaughtException", uncaughtExceptionListener);
      process.off("unhandledRejection", unhandledRejectionListener);
    });

    it("should not propagate the exception to the global context if a failed response is malformed", async () => {
      const server = http.createServer(async (_req, res) => {
        return makeResponse(res, 500);
      });
      await new Promise<void>((resolve) => {
        server.listen(0, () => resolve());
      });
      const port = (server.address() as AddressInfo).port;

      const client = createTestClient({
        url: `http://localhost:${port}`,
        compression: {
          response: true,
        },
      });

      // The request fails completely (and the error message cannot be decompressed)
      await expect(
        client.query({
          query: "SELECT 1",
          format: "JSONEachRow",
        }),
      ).rejects.toMatchObject({
        code: "Z_DATA_ERROR",
      });
    });

    it("should not propagate the exception to the global context if a successful response is malformed", async () => {
      const server = http.createServer(async (_req, res) => {
        return makeResponse(res, 200);
      });
      await new Promise<void>((resolve) => {
        server.listen(0, () => resolve());
      });
      const port = (server.address() as AddressInfo).port;

      const client = createTestClient({
        url: `http://localhost:${port}`,
        compression: {
          response: true,
        },
      });

      const rs = await client.query({
        query: "SELECT 1",
        format: "JSONEachRow",
      });

      // Fails during the response streaming
      await expect(rs.text()).rejects.toThrow();
    });
  });

  function makeResponse(res: http.ServerResponse, status: 200 | 500) {
    res.appendHeader("Content-Encoding", "gzip");
    res.statusCode = status;
    res.write("A malformed response without compression");
    return res.end();
  }
});

describe.skipIf(!zstdSupported)("[Node.js] zstd compression", () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it("round-trips an insert with zstd request compression", async ({
    skip,
  }) => {
    client = createTestClient({
      compression: { request: { codec: "zstd" } },
    });
    if (!(await isClickHouseVersionAtLeast(client, 22, 10))) {
      skip();
    }

    const tableName = `zstd_request_compression_test_${guid()}`;
    await createSimpleTable(client, tableName);

    const dataToInsert = new Array(1_000)
      .fill(0)
      .map((_v, idx) => [idx, `${idx + 5}`, [idx + 1, idx + 2]]);
    await client.insert({ table: tableName, values: dataToInsert });

    const rs = await client.query({
      query: `SELECT * FROM ${tableName}`,
      format: "JSON",
    });
    const result = await rs.json<ResponseJSON>();
    expect(result.data.length).toBe(1_000);
  });

  it("decompresses a zstd-compressed response", async ({ skip }) => {
    client = createTestClient({
      compression: { response: { codec: "zstd" } },
    });
    if (!(await isClickHouseVersionAtLeast(client, 22, 10))) {
      skip();
    }

    const rs = await client.query({
      query: `SELECT number FROM system.numbers LIMIT 20000`,
      format: "JSONEachRow",
    });
    const response = await rs.json<{ number: string }>();
    expect(response.length).toBe(20000);
    expect(response[response.length - 1].number).toBe("19999");
  });
});
