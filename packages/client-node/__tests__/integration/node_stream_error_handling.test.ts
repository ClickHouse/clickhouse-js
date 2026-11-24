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

    // The last rows and the exception block often arrive in one chunk. An
    // async iterator must get every row before the error.
    it(`gives an async iterator every ${format} row before a mid-stream exception`, async ({
      skip,
    }) => {
      if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
        skip();
      }

      const rs = await client.query({
        query: "SELECT number FROM numbers(10) WHERE throwIf(number = 5) = 0",
        format,
        clickhouse_settings: {
          ...settings,
          // One row per block, formatted in order: the server always sends
          // the rows 0 to 4 before the exception block.
          max_block_size: "1",
          max_threads: 1,
          output_format_parallel_formatting: 0,
          http_write_exception_in_output_format: 0,
        },
      });

      const rows: string[] = [];
      let caughtError: unknown;
      try {
        for await (const chunk of rs.stream()) {
          for (const row of chunk) {
            rows.push(row.text);
          }
        }
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toMatchObject({
        code: "395",
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      });
      expect(rows).toEqual(Array.from({ length: 5 }, (_, i) => `${i}\r`));
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
