/**
 * ToolJet/ToolJet — ClickHouse JS client usage example
 * ====================================================
 *
 *   Repo:        https://github.com/ToolJet/ToolJet  (~38k★)
 *   Package:     @clickhouse/client  ^1.14.0
 *   Lives in:    plugins/packages/clickhouse
 *   Analysed at: 2eb07546370d1c4959f16ab16a4d96cbea79a7e1
 *
 * How the client is used
 * ----------------------
 * ClickHouse is a first-party DATA-SOURCE CONNECTOR plugin for ToolJet's
 * low-code builder. The plugin implements the `QueryService` interface so app
 * builders can run arbitrary ClickHouse queries from the visual editor.
 *
 * Key patterns:
 *   - `import { createClient } from '@clickhouse/client'`.
 *   - Implements `QueryService` with `run()` and a `testConnection()`
 *     (`ConnectionTestResult`).
 *   - Uses `node-sql-parser` alongside the client to inspect/route SQL (omitted
 *     here — the connector contract is what matters for the test).
 *
 * References (pinned to ref=2eb07546370d1c4959f16ab16a4d96cbea79a7e1):
 *   - Plugin entry: https://github.com/ToolJet/ToolJet/blob/2eb07546370d1c4959f16ab16a4d96cbea79a7e1/plugins/packages/clickhouse/lib/index.ts
 *   - Dependency:   https://github.com/ToolJet/ToolJet/blob/2eb07546370d1c4959f16ab16a4d96cbea79a7e1/plugins/packages/clickhouse/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient } from "@test/utils";

interface ConnectionTestResult {
  status: "ok" | "failed";
  message?: string;
}

describe("oss-dependents / tooljet", () => {
  // Mirrors ToolJet's QueryService contract for the ClickHouse connector plugin.
  // The service holds one pooled client for its lifetime; `run`/`testConnection`
  // exercise the query/ping surface and the client is closed once on teardown.
  class ClickhouseQueryService {
    private client: ClickHouseClient | undefined;
    private getConnection(): ClickHouseClient {
      if (!this.client) this.client = createTestClient();
      return this.client;
    }

    async run(query: string): Promise<unknown[]> {
      const result = await this.getConnection().query({
        query,
        format: "JSONEachRow",
      });
      return result.json();
    }

    async testConnection(): Promise<ConnectionTestResult> {
      const ping = await this.getConnection().ping();
      return ping.success
        ? { status: "ok" }
        : { status: "failed", message: ping.error.message };
    }

    async close(): Promise<void> {
      await this.client?.close();
    }
  }

  let service: ClickhouseQueryService;
  afterEach(async () => {
    await service.close();
  });

  it("QueryService contract: testConnection + run", async () => {
    service = new ClickhouseQueryService();
    expect(await service.testConnection()).toEqual({ status: "ok" });
    expect(await service.run("SELECT 1 AS ok")).toEqual([{ ok: 1 }]);
  });
});
