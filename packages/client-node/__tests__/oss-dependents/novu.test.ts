/**
 * novuhq/novu — ClickHouse JS client usage example
 * ================================================
 *
 *   Repo:        https://github.com/novuhq/novu  (~39k★)
 *   Package:     @clickhouse/client  ^1.20.0
 *   Lives in:    libs/application-generic/src/services/analytic-logs
 *   Analysed at: 215418079c02fec5fbea1304835fd75985b26ae8
 *
 * How the client is used
 * ----------------------
 * ClickHouse powers Novu's ANALYTIC LOGS (workflow runs, step runs, request
 * logs, delivery-trend counts). The shared `application-generic` lib exposes a
 * NestJS `ClickHouseService` plus a batch service, and re-exports `createClient`
 * as `createClickHouseClient`.
 *
 * Key patterns:
 *   - `import { ClickHouseClient, ClickHouseSettings, createClient, PingResult }`.
 *   - `PingResult` used for health checks; `BeforeApplicationShutdown` lifecycle
 *     to close.
 *   - An `InsertOptions` type exposing `asyncInsert` — writes use ClickHouse
 *     async inserts.
 *   - A dedicated batch service and a seeding script with an `inserter`.
 *
 * References (pinned to ref=215418079c02fec5fbea1304835fd75985b26ae8):
 *   - Service:  https://github.com/novuhq/novu/blob/215418079c02fec5fbea1304835fd75985b26ae8/libs/application-generic/src/services/analytic-logs/clickhouse.service.ts
 *   - Barrel:   https://github.com/novuhq/novu/blob/215418079c02fec5fbea1304835fd75985b26ae8/libs/application-generic/src/services/analytic-logs/index.ts
 *   - Seeder:   https://github.com/novuhq/novu/blob/215418079c02fec5fbea1304835fd75985b26ae8/apps/api/scripts/clickhouse-seeder/inserter.ts
 *   - Dependency: https://github.com/novuhq/novu/blob/215418079c02fec5fbea1304835fd75985b26ae8/libs/application-generic/package.json
 *
 * Reproduction note: upstream fires async inserts with `wait_for_async_insert: 0`
 * (fire-and-forget); the test sets `1` so the written row is immediately
 * queryable for the assertion. The async-insert + ping surface is unchanged.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  createClient as createClickHouseClient,
  type ClickHouseClient,
  type ClickHouseSettings,
  type PingResult,
} from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

// Barrel re-export: `createClient` is surfaced as `createClickHouseClient`.
export { createClickHouseClient };

interface WorkflowRunLog {
  workflowId: string;
  status: string;
  timestamp: string;
}

describe("oss-dependents / novu", () => {
  const table = `oss_novu_${guid()}`;

  class ClickHouseService {
    readonly client: ClickHouseClient;
    constructor() {
      this.client = createTestClient();
    }

    // Health check using PingResult.
    async health(): Promise<boolean> {
      const result: PingResult = await this.client.ping();
      return result.success;
    }

    // Writes go through ClickHouse async inserts.
    async insertLogs(rows: WorkflowRunLog[]): Promise<void> {
      const clickhouse_settings: ClickHouseSettings = {
        async_insert: 1,
        wait_for_async_insert: 1,
      };
      await this.client.insert({
        table,
        values: rows,
        format: "JSONEachRow",
        clickhouse_settings,
      });
    }

    // beforeApplicationShutdown()
    async onShutdown(): Promise<void> {
      await this.client.close();
    }
  }

  let service: ClickHouseService;
  afterEach(async () => {
    await service.client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await service.onShutdown();
  });

  it("re-exports createClient, ping health check, async insert", async () => {
    expect(typeof createClickHouseClient).toBe("function");

    service = new ClickHouseService();
    expect(await service.health()).toBe(true);

    await service.client.command({
      query: `CREATE TABLE ${table} (workflowId String, status String, timestamp DateTime) ENGINE = MergeTree ORDER BY (workflowId, timestamp)`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await service.insertLogs([
      {
        workflowId: "wf_1",
        status: "completed",
        timestamp: "2026-01-01 00:00:00",
      },
    ]);

    const rows = await (
      await service.client.query({
        query: `SELECT workflowId, status FROM ${table}`,
        format: "JSONEachRow",
      })
    ).json<{ workflowId: string; status: string }>();
    expect(rows).toEqual([{ workflowId: "wf_1", status: "completed" }]);
  });
});
