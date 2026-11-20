import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClickHouseError } from "@clickhouse/client-common";
import type { ClickHouseClient, Row } from "@clickhouse/client-common";
import { createTestClient } from "../utils";

describe.each(["JSONEachRow", "JSONStringsEachRow"] as const)(
  "%s in-band exceptions",
  (format) => {
    let client: ClickHouseClient;
    beforeEach(() => {
      client = createTestClient();
    });
    afterEach(async () => {
      await client.close();
    });

    it.each(["json", "stream"] as const)(
      "%s() rejects an error after the response body starts",
      async (method) => {
        const rs = await client.query({
          // Send enough data to flush the server's response buffer before
          // the error, so query() succeeds with HTTP 200 in both clients.
          query: `SELECT toUInt32(number) AS n, throwIf(number = 200000, 'boom') AS e
                  FROM system.numbers LIMIT 300000`,
          format,
          clickhouse_settings: {
            max_block_size: "1000",
            http_write_exception_in_output_format: true,
            enable_http_compression: false,
          },
        });

        const received: Row[] = [];
        const consume = async () => {
          if (method === "json") {
            await rs.json();
          } else {
            const stream = rs.stream();
            if (stream instanceof ReadableStream) {
              const reader = stream.getReader();
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                received.push(...value);
              }
            } else {
              for await (const rows of stream as AsyncIterable<Row[]>) {
                received.push(...rows);
              }
            }
          }
        };
        const error = await consume().catch((err: unknown) => err);
        expect(error).toBeInstanceOf(ClickHouseError);
        expect(error).toMatchObject({
          code: "395",
          message: expect.stringContaining("boom"),
        });
        if (method === "stream") {
          expect(received.length).toBeGreaterThan(0);
          expect(
            received.every((row) => !row.text.includes('"exception"')),
          ).toBe(true);
        }
      },
    );

    it("keeps a result column named exception", async () => {
      const rs = await client.query({
        query: "SELECT 'boom' AS exception FROM numbers(2)",
        format,
        clickhouse_settings: { http_write_exception_in_output_format: true },
      });
      expect(await rs.json()).toEqual([
        { exception: "boom" },
        { exception: "boom" },
      ]);
    });
  },
);
