import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient } from "../utils";

// Regression test for the X-ClickHouse-Exception-Code header check.
//
// When `send_progress_in_http_headers` is enabled, ClickHouse commits to HTTP
// 200 before the query completes. If an exception then occurs (e.g. via
// throwIf in a WHERE clause) the server cannot change the status code; instead
// it signals the failure via the `X-ClickHouse-Exception-Code` response header.
// The client must detect that header and reject with a ClickHouseError even
// though the HTTP status is 200.
//
// Repro (adapted from the original):
//   curl -sS -i 'http://localhost:8123/?send_progress_in_http_headers=1&http_headers_progress_interval_ms=100' \
//     --data-binary "SELECT count() FROM numbers(20) WHERE sleepEachRow(0.2) = 0 AND NOT throwIf(number = 10, 'simulated mid-query failure') SETTINGS max_block_size = 1"
describe("X-ClickHouse-Exception-Code header (200 with exception)", () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it("rejects with a ClickHouseError when X-ClickHouse-Exception-Code is set on a 200 response", async () => {
    // sleepEachRow(0.05) ensures enough time passes for ClickHouse to flush the
    // first progress headers (committing the HTTP 200 status) before throwIf
    // fires at row 10, reproducing the "200 + exception header" scenario.
    await expect(
      client.query({
        query:
          "SELECT count() FROM numbers(20) WHERE sleepEachRow(0.05) = 0 AND NOT throwIf(number = 10, 'simulated mid-query failure') SETTINGS max_block_size = 1",
        clickhouse_settings: {
          send_progress_in_http_headers: 1,
          http_headers_progress_interval_ms: "100",
        },
      }),
    ).rejects.toMatchObject({
      code: "395",
      message: expect.stringContaining("simulated mid-query failure"),
    });
  });
});

it("reports the query failure after compressed result rows", async () => {
  const client = createTestClient({ compression: { response: true } });
  try {
    await expect(
      client.query({
        query: `SELECT 'Code: 60. DB::Exception: Unknown table. (UNKNOWN_TABLE) (version 1)' AS exception
                FROM numbers(10) WHERE throwIf(number = 5, 'boom') = 0`,
        format: "JSONEachRow",
        clickhouse_settings: { max_block_size: "1", max_threads: 1 },
      }),
    ).rejects.toMatchObject({
      code: "395",
      type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      message: expect.stringMatching(/^boom/),
    });
  } finally {
    await client.close();
  }
});

it("uses the header code for a multiline exception after partial text results", async () => {
  const client = createTestClient({ compression: { response: true } });
  const message = "boom\nCode: 60. DB::Exception: old log text";
  try {
    await expect(
      client.query({
        query: `SELECT 'Code: 42. DB::Exception: incomplete log entry'
                FROM numbers(10) WHERE throwIf(number = 5, {message:String}) = 0`,
        query_params: { message },
        format: "TabSeparated",
        clickhouse_settings: { max_block_size: "1", max_threads: 1 },
      }),
    ).rejects.toMatchObject({
      code: "395",
      type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      message: expect.stringContaining(message),
    });
  } finally {
    await client.close();
  }
});
