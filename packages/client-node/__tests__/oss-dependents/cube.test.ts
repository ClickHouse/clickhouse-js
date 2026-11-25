/**
 * cube-js/cube — ClickHouse JS client usage example
 * =================================================
 *
 *   Repo:        https://github.com/cube-js/cube  (~20k★)
 *   Package:     @clickhouse/client  ^1.12.0
 *   Lives in:    packages/cubejs-clickhouse-driver
 *   Analysed at: f8851968710e332121d2ad8399f9d788660275f1
 *
 * How the client is used
 * ----------------------
 * Cube ships a first-party CLICKHOUSE DRIVER. It migrated from the legacy
 * `apla-clickhouse` package to the official `@clickhouse/client` (#8928), and
 * keeps the version bumped via dependency PRs (e.g. 1.7.0 -> 1.12.0, #9829).
 *
 * Key patterns:
 *   - `import { ClickHouseClient, createClient }` + types `ClickHouseSettings`,
 *     `ResponseJSON`.
 *   - Query results consumed as `ResponseJSON`; large result sets streamed via
 *     `node:stream` `Readable`.
 *   - Used as a devDependency in cubejs-schema-compiler tests with
 *     `testcontainers` (ClickHouseDbRunner.ts).
 *
 * References (pinned to ref=f8851968710e332121d2ad8399f9d788660275f1):
 *   - Driver:      https://github.com/cube-js/cube/blob/f8851968710e332121d2ad8399f9d788660275f1/packages/cubejs-clickhouse-driver/src/ClickHouseDriver.ts
 *   - Test runner: https://github.com/cube-js/cube/blob/f8851968710e332121d2ad8399f9d788660275f1/packages/cubejs-schema-compiler/test/integration/clickhouse/ClickHouseDbRunner.ts
 *   - Dependency:  https://github.com/cube-js/cube/blob/f8851968710e332121d2ad8399f9d788660275f1/packages/cubejs-clickhouse-driver/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  type ClickHouseClient,
  type ClickHouseSettings,
  type ResponseJSON,
} from "@clickhouse/client";
import { createTestClient } from "@test/utils";

describe("oss-dependents / cube", () => {
  let driver: ClickHouseDriver;

  class ClickHouseDriver {
    private client: ClickHouseClient;

    constructor() {
      const clickhouse_settings: ClickHouseSettings = {
        // Cube reads numeric ids as strings to avoid precision loss.
        output_format_json_quote_64bit_integers: 1,
      };
      this.client = createTestClient({ clickhouse_settings });
    }

    // Query results consumed as ResponseJSON (format: 'JSON').
    async query<R>(
      query: string,
      params: Record<string, unknown>,
    ): Promise<R[]> {
      const result = await this.client.query({
        query,
        query_params: params,
        format: "JSON",
      });
      const response: ResponseJSON<R> = await result.json<R>();
      return response.data;
    }

    // Large result sets are streamed.
    async stream(query: string): Promise<number> {
      const result = await this.client.query({ query, format: "JSONEachRow" });
      const stream = result.stream();
      let rows = 0;
      for await (const chunk of stream) {
        rows += (chunk as unknown[]).length;
      }
      return rows;
    }

    async release(): Promise<void> {
      await this.client.close();
    }
  }

  afterEach(async () => {
    await driver.release();
  });

  it("typed query -> ResponseJSON.data and streamed reads", async () => {
    driver = new ClickHouseDriver();
    const rows = await driver.query<{ n: string }>("SELECT {n:UInt64} AS n", {
      n: 42,
    });
    expect(rows).toEqual([{ n: "42" }]);

    const streamed = await driver.stream(
      "SELECT number FROM system.numbers LIMIT 10",
    );
    expect(streamed).toBe(10);
  });
});
