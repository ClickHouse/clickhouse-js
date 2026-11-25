/**
 * growthbook/growthbook — ClickHouse JS client usage example
 * ==========================================================
 *
 *   Repo:        https://github.com/growthbook/growthbook  (~8k★)
 *   Package:     @clickhouse/client  ^1.0.1
 *   Lives in:    packages/back-end/src/integrations/ClickHouse.ts
 *   Analysed at: 50f46e2a978e5ef4e321be3a8d11f551d00815b8
 *
 * How the client is used
 * ----------------------
 * GrowthBook (feature flags + experimentation) treats ClickHouse as a queryable
 * DATA-SOURCE INTEGRATION. A single integration class issues SQL for experiment
 * results and feature-usage aggregation.
 *
 * Key patterns:
 *   - `import { createClient, ResponseJSON } from '@clickhouse/client'`.
 *   - Queries return `ResponseJSON`; results feed feature-usage diagnostics.
 *   - `date-fns` used to build time-windowed queries (omitted here).
 *
 * References (pinned to ref=50f46e2a978e5ef4e321be3a8d11f551d00815b8):
 *   - Integration: https://github.com/growthbook/growthbook/blob/50f46e2a978e5ef4e321be3a8d11f551d00815b8/packages/back-end/src/integrations/ClickHouse.ts
 *   - Dependency:  https://github.com/growthbook/growthbook/blob/50f46e2a978e5ef4e321be3a8d11f551d00815b8/packages/back-end/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient, type ResponseJSON } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / growthbook", () => {
  const table = `oss_growthbook_${guid()}`;

  // Mirrors GrowthBook's data-source integration class.
  class ClickHouseIntegration {
    private client: ClickHouseClient;
    constructor() {
      this.client = createTestClient();
    }

    // Run experiment / feature-usage SQL and return the full ResponseJSON.
    async runQuery<R>(sql: string): Promise<ResponseJSON<R>> {
      const result = await this.client.query({ query: sql, format: "JSON" });
      return result.json<R>();
    }

    async seed(): Promise<void> {
      await this.client.command({
        query: `CREATE TABLE ${table} (user_id String) ENGINE = MergeTree ORDER BY user_id`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      await this.client.insert({
        table,
        values: [{ user_id: "u_1" }, { user_id: "u_1" }, { user_id: "u_2" }],
        format: "JSONEachRow",
      });
    }

    async close(): Promise<void> {
      await this.client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await this.client.close();
    }
  }

  let integration: ClickHouseIntegration;
  afterEach(async () => {
    await integration.close();
  });

  it("format: 'JSON' returns ResponseJSON with rows + data", async () => {
    integration = new ClickHouseIntegration();
    await integration.seed();
    const response = await integration.runQuery<{ users: string }>(
      `SELECT uniqExact(user_id) AS users FROM ${table}`,
    );
    expect(response.rows).toBe(1);
    expect(response.data).toEqual([{ users: "2" }]);
  });
});
