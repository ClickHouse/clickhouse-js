import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  assertError,
  streamErrorQueryParams,
} from "@test/fixtures/stream_errors";
import { isClickHouseVersionAtLeast } from "@test/utils/server_version";
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseError } from "@clickhouse/client";
import { createNodeTestClient } from "../utils/node_client";

// See https://github.com/ClickHouse/ClickHouse/pull/88818
describe("[Node.js] Stream error handling", () => {
  let client: ClickHouseClient;

  beforeEach(async () => {
    client = createNodeTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it("with promise listeners", async ({ skip }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }

    let caughtError: ClickHouseError | null = null;

    try {
      const queryParams = streamErrorQueryParams();
      const rs = await client.query(queryParams);

      await new Promise<void>((resolve, reject) => {
        const stream = rs.stream<{ n: number }>();
        stream.on("data", (rows) => {
          for (const row of rows) {
            row.json(); // ignored
          }
        });
        stream.on("error", (err) => {
          reject(err);
        });
        stream.on("end", () => {
          resolve();
        });
      });
    } catch (err) {
      caughtError = err as ClickHouseError;
    }

    assertError(caughtError);
  });

  it("with async iterators", async ({ skip }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }

    let caughtError: ClickHouseError | null = null;

    try {
      const queryParams = streamErrorQueryParams();
      const rs = await client.query(queryParams);

      const stream = rs.stream();
      for await (const rows of stream) {
        for (const row of rows) {
          row.json(); // ignored
        }
      }
    } catch (err) {
      caughtError = err as ClickHouseError;
    }

    assertError(caughtError);
  });

  // The server sends one chunk per block, and with CRLF line endings most of
  // the chunks end with `\r\n`. A successful response must not fail.
  for (const { format, settings } of [
    { format: "CSV", settings: { output_format_csv_crlf_end_of_line: 1 } },
    {
      format: "TabSeparated",
      settings: { output_format_tsv_crlf_end_of_line: 1 },
    },
  ] as const) {
    it(`streams a successful ${format} response with CRLF line endings`, async ({
      skip,
    }) => {
      if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
        skip();
      }

      const rowCount = 10_000;
      const rs = await client.query({
        query: `SELECT number FROM numbers(${rowCount})`,
        format,
        clickhouse_settings: { ...settings, max_block_size: "1000" },
      });

      const rows: string[] = [];
      for await (const chunk of rs.stream()) {
        for (const row of chunk) {
          rows.push(row.text);
        }
      }

      expect(rows).toEqual(
        Array.from({ length: rowCount }, (_, i) => `${i}\r`),
      );
    });
  }

  it.skip("with .json()", async ({ skip }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }

    let caughtError: ClickHouseError | null = null;

    try {
      const queryParams = streamErrorQueryParams();
      const rs = await client.query(queryParams);
      await rs.json();
    } catch (err) {
      caughtError = err as ClickHouseError;
    }

    assertError(caughtError);
  });

  it.skip("with .text()", async ({ skip }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }

    let caughtError: ClickHouseError | null = null;

    try {
      const queryParams = streamErrorQueryParams();
      const rs = await client.query(queryParams);
      await rs.text();
    } catch (err) {
      caughtError = err as ClickHouseError;
    }

    assertError(caughtError);
  });
});
