/**
 * Infisical/infisical — ClickHouse JS client usage example
 * ========================================================
 *
 *   Repo:        https://github.com/Infisical/infisical  (~26k★)
 *   Package:     @clickhouse/client  ^1.17.0
 *   Lives in:    backend/src
 *   Analysed at: 3d47c85f52fa33c7337ad9f328359db806073d4f
 *
 * How the client is used
 * ----------------------
 * ClickHouse is used as the AUDIT-LOG store and is also exposed as a
 * DYNAMIC-SECRET provider. The client is built from config (returns `null` when
 * unconfigured), wired into the Fastify app, and has its own migration runner.
 *
 * Key patterns:
 *   - `import { type ClickHouseClient, createClient }` in a config builder
 *     (`buildClickHouseFromConfig`).
 *   - Audit-log DAL + queue for buffered writes.
 *   - DDL migrations (e.g. `CREATE TABLE ... generateUUIDv7()`).
 *   - Dynamic-secret provider creates short-lived CH credentials.
 *
 * References (pinned to ref=3d47c85f52fa33c7337ad9f328359db806073d4f):
 *   - Config builder:  https://github.com/Infisical/infisical/blob/3d47c85f52fa33c7337ad9f328359db806073d4f/backend/src/lib/config/clickhouse.ts
 *   - Audit-log DAL:   https://github.com/Infisical/infisical/blob/3d47c85f52fa33c7337ad9f328359db806073d4f/backend/src/ee/services/audit-log/audit-log-clickhouse-dal.ts
 *   - Migration runner: https://github.com/Infisical/infisical/blob/3d47c85f52fa33c7337ad9f328359db806073d4f/backend/src/db/clickhouse-migration-runner.ts
 *   - Dynamic secret:  https://github.com/Infisical/infisical/blob/3d47c85f52fa33c7337ad9f328359db806073d4f/backend/src/ee/services/dynamic-secret/providers/clickhouse.ts
 *   - Dependency:      https://github.com/Infisical/infisical/blob/3d47c85f52fa33c7337ad9f328359db806073d4f/backend/package.json
 *
 * Reproduction note: upstream defaults ids with `generateUUIDv7()`; we use
 * `generateUUIDv4()` for broad server-version support. The `null`-when-
 * unconfigured guard and the command/insert surface are what is exercised.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

interface ClickHouseConfig {
  // When falsy, the audit-log store is considered unconfigured.
  url?: string;
}

describe("oss-dependents / infisical", () => {
  let client: ClickHouseClient | null = null;
  const table = `oss_infisical_${guid()}`;

  // buildClickHouseFromConfig — returns null when unconfigured. When configured,
  // upstream calls createClient(...); here connection params come from the test
  // helper, so the `url` value only drives the configured/unconfigured branch.
  function buildClickHouseFromConfig(
    config: ClickHouseConfig,
  ): ClickHouseClient | null {
    if (!config.url) return null;
    return createTestClient();
  }

  // DDL migration runner.
  async function runMigrations(c: ClickHouseClient): Promise<void> {
    await c.command({
      query: `
        CREATE TABLE IF NOT EXISTS ${table} (
          id UUID DEFAULT generateUUIDv4(),
          actor String,
          event String,
          timestamp DateTime DEFAULT now()
        ) ENGINE = MergeTree ORDER BY (timestamp, id)
      `,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
  }

  // Audit-log DAL: buffered write of audit events.
  async function pushAuditLogs(
    c: ClickHouseClient,
    events: { actor: string; event: string }[],
  ): Promise<void> {
    await c.insert({ table, values: events, format: "JSONEachRow" });
  }

  afterEach(async () => {
    if (client) {
      await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await client.close();
      client = null;
    }
  });

  it("returns null when unconfigured", () => {
    expect(buildClickHouseFromConfig({ url: undefined })).toBeNull();
  });

  it("migration runner + audit-log insert", async () => {
    client = buildClickHouseFromConfig({ url: "configured" });
    expect(client).not.toBeNull();
    await runMigrations(client!);
    await pushAuditLogs(client!, [{ actor: "user_1", event: "secret.read" }]);

    const rows = await (
      await client!.query({
        query: `SELECT actor, event FROM ${table}`,
        format: "JSONEachRow",
      })
    ).json<{ actor: string; event: string }>();
    expect(rows).toEqual([{ actor: "user_1", event: "secret.read" }]);
  });
});
