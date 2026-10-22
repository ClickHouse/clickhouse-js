import { describe, it, beforeEach, afterEach, expect } from "vitest";
import {
  assertError,
  inBandStreamErrorQueryParams,
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

  // See https://github.com/ClickHouse/clickhouse-js/issues/1053
  describe("with http_write_exception_in_output_format = 1", () => {
    it("with async iterators", async () => {
      let caughtError: ClickHouseError | null = null;
      const received: unknown[] = [];

      try {
        const rs = await client.query(inBandStreamErrorQueryParams());
        for await (const rows of rs.stream()) {
          for (const row of rows) {
            received.push(row.json());
          }
        }
      } catch (err) {
        caughtError = err as ClickHouseError;
      }

      assertError(caughtError);
      expect(received).not.toContainEqual(
        expect.objectContaining({ exception: expect.anything() }),
      );
    });

    it("with .json()", async () => {
      let caughtError: ClickHouseError | null = null;

      try {
        const rs = await client.query(inBandStreamErrorQueryParams());
        await rs.json();
      } catch (err) {
        caughtError = err as ClickHouseError;
      }

      assertError(caughtError);
    });

    it("should return a genuine column named exception as data", async () => {
      const rs = await client.query({
        query: `SELECT 'Code: 395. DB::Exception: boom. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)' AS exception`,
        format: "JSONEachRow",
        clickhouse_settings: {
          http_write_exception_in_output_format: true,
        },
      });
      expect(await rs.json()).toEqual([
        {
          exception:
            "Code: 395. DB::Exception: boom. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)",
        },
      ]);
    });
  });
});
