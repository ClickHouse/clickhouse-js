/**
 * firecrawl/firecrawl — ClickHouse JS client usage example
 * ========================================================
 *
 *   Repo:        https://github.com/firecrawl/firecrawl  (~112k★)
 *   Package:     @clickhouse/client  ^1.8.1
 *   Lives in:    apps/api/src/lib/clickhouse-client.ts (the scraping API service)
 *   Analysed at: df88fb6d5e6a328b1f8c05fcb341b78fe581dfc7
 *
 * How the client is used
 * ----------------------
 * ClickHouse is an OPTIONAL analytics sink. A single module creates the client
 * only when the `CLICKHOUSE_ANALYTICS_URL` env var is set, otherwise it stays
 * `null` and analytics writes are skipped — a defensive pattern for self-hosters
 * who do not run ClickHouse.
 *
 * Key patterns:
 *   - `createClient({ url })` guarded by an env var; client may be `null`.
 *   - Every call site null-checks the client before inserting analytics rows.
 *
 * References (pinned to ref=df88fb6d5e6a328b1f8c05fcb341b78fe581dfc7):
 *   - Client factory: https://github.com/firecrawl/firecrawl/blob/df88fb6d5e6a328b1f8c05fcb341b78fe581dfc7/apps/api/src/lib/clickhouse-client.ts
 *   - Dependency:     https://github.com/firecrawl/firecrawl/blob/df88fb6d5e6a328b1f8c05fcb341b78fe581dfc7/apps/api/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

interface ScrapeEvent {
  url: string;
  status: number;
  ts: string;
}

describe("oss-dependents / firecrawl", () => {
  const table = `oss_firecrawl_${guid()}`;

  // The client is created only when analytics is configured, otherwise `null`.
  function buildClient(analyticsConfigured: boolean): ClickHouseClient | null {
    return analyticsConfigured ? createTestClient() : null;
  }

  // Analytics writes are skipped entirely when ClickHouse is not configured.
  async function logScrape(
    client: ClickHouseClient | null,
    event: ScrapeEvent,
  ): Promise<void> {
    if (!client) return;
    await client.insert({ table, values: [event], format: "JSONEachRow" });
  }

  let client: ClickHouseClient | null = null;
  afterEach(async () => {
    if (client) {
      await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await client.close();
      client = null;
    }
  });

  it("is a no-op when analytics is disabled (null client)", async () => {
    client = buildClient(false);
    expect(client).toBeNull();
    await expect(
      logScrape(client, {
        url: "https://example.com",
        status: 200,
        ts: "2026-01-01 00:00:00",
      }),
    ).resolves.toBeUndefined();
  });

  it("inserts analytics rows when configured", async () => {
    client = buildClient(true);
    expect(client).not.toBeNull();
    await client!.command({
      query: `CREATE TABLE ${table} (url String, status UInt16, ts DateTime) ENGINE = MergeTree ORDER BY ts`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await logScrape(client, {
      url: "https://example.com",
      status: 200,
      ts: "2026-01-01 00:00:00",
    });

    const rows = await (
      await client!.query({
        query: `SELECT url, status FROM ${table}`,
        format: "JSONEachRow",
      })
    ).json<{ url: string; status: number }>();
    expect(rows).toEqual([{ url: "https://example.com", status: 200 }]);
  });
});
