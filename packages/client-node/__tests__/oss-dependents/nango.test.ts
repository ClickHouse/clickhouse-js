/**
 * NangoHQ/nango — ClickHouse JS client usage example
 * ==================================================
 *
 *   Repo:        https://github.com/NangoHQ/nango  (~7k★)
 *   Package:     @clickhouse/client  1.18.2 (pinned, exact)
 *   Lives in:    packages/usage/lib/clickhouse
 *   Analysed at: 32a588d5d4a02cba6a869654a3c849ea16d741b0
 *
 * How the client is used
 * ----------------------
 * Nango (integrations platform) uses ClickHouse in a dedicated `usage` package
 * for METERING / BILLING. A small `config.ts` creates the client and exposes the
 * `ClickHouseClient` type to the rest of the package.
 *
 * Key patterns:
 *   - `import { createClient } from '@clickhouse/client'` + `import type
 *     { ClickHouseClient }`.
 *   - Configuration driven by env parsing (reproduced with process.env here).
 *   - Pinned to an exact client version (1.18.2).
 *
 * References (pinned to ref=32a588d5d4a02cba6a869654a3c849ea16d741b0):
 *   - Client config: https://github.com/NangoHQ/nango/blob/32a588d5d4a02cba6a869654a3c849ea16d741b0/packages/usage/lib/clickhouse/config.ts
 *   - Dependency:    https://github.com/NangoHQ/nango/blob/32a588d5d4a02cba6a869654a3c849ea16d741b0/packages/usage/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / nango", () => {
  const table = `oss_nango_${guid()}`;

  // config.ts — single factory consuming parsed env vars.
  function createUsageClient(): ClickHouseClient {
    return createTestClient();
  }

  // Metering write: record a billable usage record.
  async function recordUsage(
    client: ClickHouseClient,
    record: { accountId: string; metric: string; value: number },
  ): Promise<void> {
    await client.insert({ table, values: [record], format: "JSONEachRow" });
  }

  let client: ClickHouseClient;
  afterEach(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
  });

  it("usage-metering insert via the config factory", async () => {
    client = createUsageClient();
    await client.command({
      query: `CREATE TABLE ${table} (accountId String, metric String, value UInt64) ENGINE = MergeTree ORDER BY (accountId, metric)`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await recordUsage(client, {
      accountId: "acc_1",
      metric: "records_synced",
      value: 1000,
    });

    const rows = await (
      await client.query({
        query: `SELECT accountId, metric, value FROM ${table}`,
        format: "JSONEachRow",
      })
    ).json<{ accountId: string; metric: string; value: string }>();
    expect(rows).toEqual([
      { accountId: "acc_1", metric: "records_synced", value: "1000" },
    ]);
  });
});
