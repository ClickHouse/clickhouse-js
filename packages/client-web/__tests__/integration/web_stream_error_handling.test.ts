import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  assertError,
  inBandStreamErrorQueryParams,
  streamErrorQueryParams,
} from "@test/fixtures/stream_errors";
import { isClickHouseVersionAtLeast } from "@test/utils/server_version";
import type { ClickHouseClient } from "@clickhouse/client-web";
import type { ClickHouseError } from "@clickhouse/client-web";
import { createWebTestClient } from "../utils/web_client";

// See https://github.com/ClickHouse/ClickHouse/pull/88818
describe("[Web] Stream error handling", () => {
  let client: ClickHouseClient;

  beforeEach(async () => {
    client = createWebTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it("with reader", async ({ skip }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }

    let caughtError: ClickHouseError | null = null;

    try {
      const queryParams = streamErrorQueryParams();
      const rs = await client.query(queryParams);

      const reader = rs.stream<{ n: number }>().getReader();
      while (true) {
        const { done, value: rows } = await reader.read();
        if (done) break;
        for (const row of rows) {
          row.json(); // ignored
        }
      }
    } catch (err) {
      caughtError = err as ClickHouseError;
    }

    assertError(caughtError);
  });

  // See https://github.com/ClickHouse/clickhouse-js/issues/1053
  it("with reader and http_write_exception_in_output_format = 1", async () => {
    let caughtError: ClickHouseError | null = null;

    try {
      const params = inBandStreamErrorQueryParams();
      const rs = await client.query({
        ...params,
        clickhouse_settings: {
          ...params.clickhouse_settings,
          // With compression, the server buffers the body and answers
          // HTTP 500, so the test does not reach the stream.
          enable_http_compression: 0,
        },
      });
      const reader = rs.stream<{ n: number }>().getReader();
      while (true) {
        const { done, value: rows } = await reader.read();
        if (done) break;
        for (const row of rows) {
          expect(row.json()).not.toHaveProperty("exception");
        }
      }
    } catch (err) {
      caughtError = err as ClickHouseError;
    }

    assertError(caughtError);
  });
});
