/**
 * dbgate/dbgate — ClickHouse JS client usage example
 * ==================================================
 *
 *   Repo:        https://github.com/dbgate/dbgate  (~7k★)
 *   Package:     @clickhouse/client  ^1.5.0
 *   Lives in:    plugins/dbgate-plugin-clickhouse
 *   Analysed at: 6bacb1c81e8e330ca0ee163ec06202b68a1e0591
 *
 * How the client is used
 * ----------------------
 * DbGate is a cross-platform database manager; ClickHouse support ships as a
 * DRIVER PLUGIN. The plugin backend uses the client for querying, schema
 * analysis and bulk inserts.
 *
 * Key patterns:
 *   - Upstream is CommonJS: `const { createClient } = require('@clickhouse/client')`
 *     implementing DbGate's `EngineDriver`. Reproduced here with an ESM import.
 *   - A custom `createBulkInsertStream` for efficient bulk loading — reproduced
 *     using the client's streaming insert (an async row generator as `values`).
 *   - The client is listed in `volatilePackages` so it is never webpack-bundled
 *     (loaded at runtime as a native dependency).
 *
 * References (pinned to ref=6bacb1c81e8e330ca0ee163ec06202b68a1e0591):
 *   - Driver:       https://github.com/dbgate/dbgate/blob/6bacb1c81e8e330ca0ee163ec06202b68a1e0591/plugins/dbgate-plugin-clickhouse/src/backend/driver.js
 *   - volatilePackages: https://github.com/dbgate/dbgate/blob/6bacb1c81e8e330ca0ee163ec06202b68a1e0591/common/volatilePackages.js
 *   - Dependency:   https://github.com/dbgate/dbgate/blob/6bacb1c81e8e330ca0ee163ec06202b68a1e0591/plugins/dbgate-plugin-clickhouse/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / dbgate", () => {
  let client: ClickHouseClient;
  const table = `oss_dbgate_${guid()}`;

  // Querying surface used by the GUI grid.
  async function runQuery(
    c: ClickHouseClient,
    query: string,
  ): Promise<unknown[]> {
    const result = await c.query({ query, format: "JSONEachRow" });
    return result.json();
  }

  // createBulkInsertStream — efficient bulk loading from a streamed row source.
  async function bulkInsert(
    c: ClickHouseClient,
    rows: Readable,
  ): Promise<void> {
    await c.insert({ table, values: rows, format: "JSONEachRow" });
  }

  async function* sampleRows(): AsyncGenerator<Record<string, unknown>> {
    for (let i = 0; i < 1000; i++) {
      yield { id: i, name: `row_${i}` };
    }
  }

  afterEach(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
  });

  it("streaming bulk insert from an async row generator", async () => {
    client = createTestClient();
    await client.command({
      query: `CREATE TABLE ${table} (id UInt32, name String) ENGINE = MergeTree ORDER BY id`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await bulkInsert(client, Readable.from(sampleRows()));

    const result = await runQuery(client, `SELECT count() AS n FROM ${table}`);
    expect(result).toEqual([{ n: "1000" }]);
  });
});
