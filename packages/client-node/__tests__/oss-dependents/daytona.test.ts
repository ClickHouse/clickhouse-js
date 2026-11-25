/**
 * daytonaio/daytona — ClickHouse JS client usage example
 * ======================================================
 *
 *   Repo:        https://github.com/daytonaio/daytona  (~72k★)
 *   Package:     @clickhouse/client  ^1.16.0
 *   Lives in:    apps/api/src/clickhouse
 *   Analysed at: 8be4772fbff159856b99ca595622a7fb1e64e63a
 *
 * How the client is used
 * ----------------------
 * A NestJS `ClickHouseService` wraps the client for usage analytics. The client
 * is LAZILY instantiated from config (returns `null` when ClickHouse is not
 * configured), and properly closed on module destroy.
 *
 * Key patterns:
 *   - `createClient({ url, username, password, database })`.
 *   - Reads via `client.query({ query, query_params, format: 'JSONEachRow',
 *     clickhouse_settings: { date_time_input_format: 'best_effort' } })` then
 *     `result.json()`.
 *   - A thin `query<T>()` / `queryOne<T>()` typed wrapper.
 *   - `await this.client.close()` in `onModuleDestroy()`.
 *
 * References (pinned to ref=8be4772fbff159856b99ca595622a7fb1e64e63a):
 *   - Service: https://github.com/daytonaio/daytona/blob/8be4772fbff159856b99ca595622a7fb1e64e63a/apps/api/src/clickhouse/clickhouse.service.ts
 *   - Dependency: https://github.com/daytonaio/daytona/blob/8be4772fbff159856b99ca595622a7fb1e64e63a/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / daytona", () => {
  const table = `oss_daytona_${guid()}`;

  // Mirrors the NestJS service: lazy client, typed query helpers, clean shutdown.
  // `configured` stands in for the presence of a CLICKHOUSE_URL in upstream.
  class ClickHouseService {
    private client: ClickHouseClient | null = null;
    constructor(private readonly configured: boolean) {}

    private getClient(): ClickHouseClient | null {
      if (this.client) return this.client;
      if (!this.configured) return null;
      this.client = createTestClient();
      return this.client;
    }

    async query<T>(
      query: string,
      query_params?: Record<string, unknown>,
    ): Promise<T[]> {
      const client = this.getClient();
      if (!client) return [];
      const result = await client.query({
        query,
        query_params,
        format: "JSONEachRow",
        clickhouse_settings: { date_time_input_format: "best_effort" },
      });
      return result.json<T>();
    }

    async queryOne<T>(
      query: string,
      query_params?: Record<string, unknown>,
    ): Promise<T | null> {
      const rows = await this.query<T>(query, query_params);
      return rows[0] ?? null;
    }

    // onModuleDestroy()
    async close(): Promise<void> {
      await this.client?.close();
    }
  }

  let service: ClickHouseService;
  afterEach(async () => {
    // Each test closes its own service; drop the table via a throwaway client.
    const cleanup = createTestClient();
    await cleanup.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await cleanup.close();
  });

  it("returns empty results when not configured", async () => {
    service = new ClickHouseService(false);
    expect(await service.query("SELECT 1")).toEqual([]);
    expect(await service.queryOne("SELECT 1")).toBeNull();
    await service.close();
  });

  it("typed query/queryOne with {table:Identifier} param", async () => {
    service = new ClickHouseService(true);
    const setup = createTestClient();
    await setup.command({
      query: `CREATE TABLE ${table} (id UInt32) ENGINE = MergeTree ORDER BY id`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await setup.insert({
      table,
      values: [{ id: 1 }, { id: 2 }, { id: 3 }],
      format: "JSONEachRow",
    });
    await setup.close();

    const row = await service.queryOne<{ total: string }>(
      "SELECT count() AS total FROM {table:Identifier}",
      { table },
    );
    expect(row?.total).toBe("3");
    await service.close();
  });
});
