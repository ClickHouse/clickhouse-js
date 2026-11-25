/**
 * twentyhq/twenty — ClickHouse JS client usage example
 * ====================================================
 *
 *   Repo:        https://github.com/twentyhq/twenty  (~45k★)
 *   Package:     @clickhouse/client  ^1.18.1
 *   Lives in:    packages/twenty-server/src/database/clickHouse
 *   Analysed at: f96e36d3e67510eaf81ee130d8d56c3db563ec3f
 *
 * How the client is used
 * ----------------------
 * ClickHouse backs the CRM's EVENT-LOG analytics. A dedicated
 * `clickHouse.service.ts` creates the client; there is a full lifecycle around
 * it: migrations runner, seed runner, and integration test suites that write
 * object / workspace events.
 *
 * Key patterns:
 *   - `import { type ClickHouseClient, ClickHouseLogLevel, createClient }`.
 *   - `ClickHouseLogLevel` passed to `createClient` to control client logging.
 *   - Migrations (`run-migrations.ts`) and seeds (`run-seeds.ts`) share the same
 *     import surface.
 *   - Service is mocked in unit tests via `jest.mock('@clickhouse/client')`.
 *
 * References (pinned to ref=f96e36d3e67510eaf81ee130d8d56c3db563ec3f):
 *   - Service:    https://github.com/twentyhq/twenty/blob/f96e36d3e67510eaf81ee130d8d56c3db563ec3f/packages/twenty-server/src/database/clickHouse/clickHouse.service.ts
 *   - Migrations: https://github.com/twentyhq/twenty/blob/f96e36d3e67510eaf81ee130d8d56c3db563ec3f/packages/twenty-server/src/database/clickHouse/migrations/run-migrations.ts
 *   - Seeds:      https://github.com/twentyhq/twenty/blob/f96e36d3e67510eaf81ee130d8d56c3db563ec3f/packages/twenty-server/src/database/clickHouse/seeds/run-seeds.ts
 *   - Dependency: https://github.com/twentyhq/twenty/blob/f96e36d3e67510eaf81ee130d8d56c3db563ec3f/packages/twenty-server/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ClickHouseLogLevel, type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / twenty", () => {
  let client: ClickHouseClient;
  const table = `oss_twenty_${guid()}`;

  function createCrmClient(): ClickHouseClient {
    return createTestClient({
      // Control client logging verbosity via the exported enum.
      log: { level: ClickHouseLogLevel.WARN },
    });
  }

  // run-migrations.ts — shares the same import surface as the service.
  async function runMigrations(c: ClickHouseClient): Promise<void> {
    await c.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${table} (
          workspaceId String,
          name String,
          timestamp DateTime
        ) ENGINE = MergeTree ORDER BY (workspaceId, timestamp)
      `,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
  }

  // run-seeds.ts — write some workspace/object events.
  async function runSeeds(c: ClickHouseClient): Promise<void> {
    await c.insert({
      table,
      values: [
        {
          workspaceId: "ws_1",
          name: "company.created",
          timestamp: "2026-01-01 00:00:00",
        },
      ],
      format: "JSONEachRow",
    });
  }

  afterEach(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
  });

  it("ClickHouseLogLevel config, command migrations + insert seeds", async () => {
    client = createCrmClient();
    await runMigrations(client);
    await runSeeds(client);

    const rows = await (
      await client.query({
        query: `SELECT workspaceId, name FROM ${table}`,
        format: "JSONEachRow",
      })
    ).json<{ workspaceId: string; name: string }>();
    expect(rows).toEqual([{ workspaceId: "ws_1", name: "company.created" }]);
  });
});
