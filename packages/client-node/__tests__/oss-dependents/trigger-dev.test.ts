/**
 * triggerdotdev/trigger.dev — ClickHouse JS client usage example
 * ==============================================================
 *
 *   Repo:        https://github.com/triggerdotdev/trigger.dev  (~15k★)
 *   Package:     @clickhouse/client  ^1.12.1
 *   Lives in:    internal-packages/clickhouse
 *   Analysed at: ae08c9cb600b00256440bccb336745f01acdf60b
 *
 * How the client is used
 * ----------------------
 * trigger.dev wraps the client in a dedicated internal package that backs the
 * RUN/EVENT store and analytics surfaces (run list, metrics, data export). The
 * package exposes a high-level `ClickHouse` class split into reader and writer
 * roles, and a TSQL layer that sanitises errors and maps schema values.
 *
 * Key patterns:
 *   - A `ClickHouse` class with `reader`/`writer` and an injected `Logger`.
 *   - `ClickhouseCommonConfig` (url/readerUrl) to split read vs write endpoints.
 *   - TSQL helpers with ClickHouse-internals-to-user-friendly error sanitisation.
 *
 * References (pinned to ref=ae08c9cb600b00256440bccb336745f01acdf60b):
 *   - Package entry: https://github.com/triggerdotdev/trigger.dev/blob/ae08c9cb600b00256440bccb336745f01acdf60b/internal-packages/clickhouse/src/index.ts
 *   - TSQL layer:    https://github.com/triggerdotdev/trigger.dev/blob/ae08c9cb600b00256440bccb336745f01acdf60b/internal-packages/clickhouse/src/client/tsql.ts
 *   - Webapp factory: https://github.com/triggerdotdev/trigger.dev/blob/ae08c9cb600b00256440bccb336745f01acdf60b/apps/webapp/app/services/clickhouse/clickhouseFactory.server.ts
 *   - Dependency:    https://github.com/triggerdotdev/trigger.dev/blob/ae08c9cb600b00256440bccb336745f01acdf60b/internal-packages/clickhouse/package.json
 *
 * Reproduction note: reader and writer both point at the test server (the
 * read-replica split is the surface under test, not a separate endpoint).
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / trigger.dev", () => {
  const table = `oss_trigger_dev_${guid()}`;

  // Reader/writer split so reads can target a replica.
  class ClickHouse {
    readonly reader: ClickHouseClient;
    readonly writer: ClickHouseClient;

    constructor() {
      this.writer = createTestClient();
      this.reader = createTestClient();
    }

    async createSchema(): Promise<void> {
      await this.writer.command({
        query: `CREATE TABLE ${table} (runId String, event String) ENGINE = MergeTree ORDER BY runId`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
    }

    async insertRunEvents(
      rows: { runId: string; event: string }[],
    ): Promise<void> {
      await this.writer.insert({ table, values: rows, format: "JSONEachRow" });
    }

    async listRuns(): Promise<{ runId: string }[]> {
      const result = await this.reader.query({
        query: `SELECT runId FROM ${table} ORDER BY runId`,
        format: "JSONEachRow",
      });
      return result.json<{ runId: string }>();
    }

    async close(): Promise<void> {
      await this.writer.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await Promise.all([this.reader.close(), this.writer.close()]);
    }
  }

  let ch: ClickHouse;
  afterEach(async () => {
    await ch.close();
  });

  it("reader/writer split: write via writer, read via reader", async () => {
    ch = new ClickHouse();
    await ch.createSchema();
    await ch.insertRunEvents([
      { runId: "run_1", event: "started" },
      { runId: "run_2", event: "started" },
    ]);
    expect(await ch.listRuns()).toEqual([
      { runId: "run_1" },
      { runId: "run_2" },
    ]);
  });
});
