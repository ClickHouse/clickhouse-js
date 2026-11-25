/**
 * langfuse/langfuse — ClickHouse JS client usage example
 * ======================================================
 *
 *   Repo:        https://github.com/langfuse/langfuse  (~26k★)
 *   Package:     @clickhouse/client  ^1.18.5
 *   Lives in:    packages/shared/src/server
 *   Analysed at: dee4118e8e9e672bc59a844a0ee3addd6a34a144
 *   Test partner: beta release-test branch peter_leonov_ch_clickhouse_client_beta_test
 *                 (https://github.com/langfuse/langfuse/pull/12341)
 *
 * How the client is used
 * ----------------------
 * The DEEPEST integration in this set. ClickHouse is langfuse's analytical
 * backbone for traces, observations, scores, events and sessions. The shared
 * package builds a heavily-instrumented custom client and a repository layer on
 * top.
 *
 * Key patterns:
 *   - `createClient({ ... })` with `ClickHouseSettings`.
 *   - Custom LOGGER implementing the client `Logger` interface, mapping
 *     ClickHouse log levels to Winston (`mapLogLevel`).
 *   - OpenTelemetry spans wrapped around every query (omitted here).
 *   - Read/write/command wrappers; `commandClickhouse` for DDL; `InsertResult`.
 *   - Unit tests that `vi.mock('@clickhouse/client')`.
 *   - Upstream also deep-imports `@clickhouse/client/dist/config`
 *     (NodeClickHouseClientConfigOptions), which makes it sensitive to the
 *     client's published file layout — flagged but intentionally NOT reproduced
 *     here (we depend on the public export surface only).
 *
 * References (pinned to ref=dee4118e8e9e672bc59a844a0ee3addd6a34a144):
 *   - Client factory: https://github.com/langfuse/langfuse/blob/dee4118e8e9e672bc59a844a0ee3addd6a34a144/packages/shared/src/server/clickhouse/client.ts
 *   - Custom logger:  https://github.com/langfuse/langfuse/blob/dee4118e8e9e672bc59a844a0ee3addd6a34a144/packages/shared/src/server/clickhouse/clickhouse-logger.ts
 *   - Repository base: https://github.com/langfuse/langfuse/blob/dee4118e8e9e672bc59a844a0ee3addd6a34a144/packages/shared/src/server/repositories/clickhouse.ts
 *   - Seeder:         https://github.com/langfuse/langfuse/blob/dee4118e8e9e672bc59a844a0ee3addd6a34a144/packages/shared/scripts/seeder/utils/clickhouse-builder.ts
 *   - Dependency:     https://github.com/langfuse/langfuse/blob/dee4118e8e9e672bc59a844a0ee3addd6a34a144/packages/shared/package.json
 *
 * The reproduction below targets the CURRENT 1.x client API and runs against the
 * test ClickHouse via the shared `createTestClient` helper (which forwards the
 * langfuse-specific `clickhouse_settings` / `log` options to `createClient`).
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  ClickHouseLogLevel,
  type ClickHouseClient,
  type ClickHouseSettings,
  type ErrorLogParams,
  type InsertResult,
  type LogParams,
  type Logger,
} from "@clickhouse/client";
import { createTestClient, guid, validateUUID } from "@test/utils";

// Custom logger implementing the client Logger interface (maps to Winston in
// the real codebase via `mapLogLevel`). We just record what was logged.
class LangfuseClickHouseLogger implements Logger {
  readonly entries: string[] = [];
  trace({ module, message }: LogParams): void {
    this.entries.push(`trace [${module}] ${message}`);
  }
  debug({ module, message }: LogParams): void {
    this.entries.push(`debug [${module}] ${message}`);
  }
  info({ module, message }: LogParams): void {
    this.entries.push(`info [${module}] ${message}`);
  }
  warn({ module, message }: LogParams): void {
    this.entries.push(`warn [${module}] ${message}`);
  }
  error({ module, message }: ErrorLogParams): void {
    this.entries.push(`error [${module}] ${message}`);
  }
}

function getClickhouseClient(): ClickHouseClient {
  const clickhouse_settings: ClickHouseSettings = {
    async_insert: 1,
    wait_for_async_insert: 1,
  };
  return createTestClient({
    clickhouse_settings,
    log: {
      level: ClickHouseLogLevel.INFO,
      LoggerClass: LangfuseClickHouseLogger,
    },
  });
}

// Repository base — read/write/command wrappers.
async function queryClickhouse<T>(
  client: ClickHouseClient,
  query: string,
  params?: Record<string, unknown>,
): Promise<T[]> {
  const result = await client.query({
    query,
    query_params: params,
    format: "JSONEachRow",
  });
  return result.json<T>();
}

async function commandClickhouse(
  client: ClickHouseClient,
  query: string,
): Promise<void> {
  await client.command({
    query,
    clickhouse_settings: { wait_end_of_query: 1 },
  });
}

// Seeder uses InsertResult.
async function insertTraces(
  client: ClickHouseClient,
  table: string,
  rows: unknown[],
): Promise<InsertResult> {
  return client.insert({ table, values: rows, format: "JSONEachRow" });
}

describe("oss-dependents / langfuse", () => {
  let client: ClickHouseClient;
  const table = `oss_langfuse_${guid()}`;

  afterEach(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
  });

  it("custom Logger + async_insert: command DDL, InsertResult, typed query", async () => {
    client = getClickhouseClient();
    await commandClickhouse(
      client,
      `CREATE TABLE ${table} (id String, name String) ENGINE = MergeTree ORDER BY id`,
    );
    const result = await insertTraces(client, table, [
      { id: "t_1", name: "generation" },
    ]);
    expect(validateUUID(result.query_id)).toBeTruthy();

    const rows = await queryClickhouse<{ id: string }>(
      client,
      `SELECT id FROM ${table} ORDER BY id`,
    );
    expect(rows).toEqual([{ id: "t_1" }]);
  });
});
