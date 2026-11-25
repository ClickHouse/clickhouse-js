/**
 * umami-software/umami — ClickHouse JS client usage example
 * =========================================================
 *
 *   Repo:        https://github.com/umami-software/umami  (~36k★)
 *   Package:     @clickhouse/client  ^1.18.2
 *   Lives in:    src/lib/clickhouse.ts
 *   Analysed at: c0ea3aefbee7a3429ee2f824b06dc4a9dbe0b7e1
 *
 * How the client is used
 * ----------------------
 * Umami is a privacy-focused web-analytics app; ClickHouse is its optional
 * high-volume event store (alternative to Postgres/MySQL). A single
 * `src/lib/clickhouse.ts` module builds the client and exposes typed query
 * helpers that translate Umami's `QueryFilters`/`QueryOptions` into ClickHouse
 * SQL.
 *
 * Key patterns:
 *   - `import { type ClickHouseClient, createClient } from '@clickhouse/client'`.
 *   - Centralised filter -> SQL translation (FILTER_COLUMNS, OPERATORS) feeding
 *     `query`/`insert`.
 *   - Timezone handling via `date-fns-tz` around ClickHouse `DateTime` values
 *     (omitted here — the query/insert surface is what the test exercises).
 *
 * References (pinned to ref=c0ea3aefbee7a3429ee2f824b06dc4a9dbe0b7e1):
 *   - ClickHouse layer: https://github.com/umami-software/umami/blob/c0ea3aefbee7a3429ee2f824b06dc4a9dbe0b7e1/src/lib/clickhouse.ts
 *   - Dependency:       https://github.com/umami-software/umami/blob/c0ea3aefbee7a3429ee2f824b06dc4a9dbe0b7e1/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse
 * via the shared `createTestClient` helper (the lazy singleton below).
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / umami", () => {
  // Mirrors umami's lazy module-level singleton.
  let client: ClickHouseClient | undefined;
  function getClient(): ClickHouseClient {
    if (!client) {
      client = createTestClient();
    }
    return client;
  }

  const table = `oss_umami_${guid()}`;

  interface WebsiteEvent {
    website_id: string;
    session_id: string;
    event_name: string;
    created_at: string;
  }

  async function saveEvent(event: WebsiteEvent): Promise<void> {
    await getClient().insert({ table, values: [event], format: "JSONEachRow" });
  }

  // Typed read helper translating analytics filters into parameterised SQL.
  async function getPageViews(
    websiteId: string,
    startAt: string,
    endAt: string,
  ) {
    const result = await getClient().query({
      query: `
        SELECT event_name, count() AS views
        FROM ${table}
        WHERE website_id = {websiteId:String}
          AND created_at BETWEEN {startAt:DateTime} AND {endAt:DateTime}
        GROUP BY event_name
      `,
      query_params: { websiteId, startAt, endAt },
      format: "JSONEachRow",
    });
    return result.json<{ event_name: string; views: string }>();
  }

  afterEach(async () => {
    if (client) {
      await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await client.close();
      client = undefined;
    }
  });

  it("parameterised query (String + DateTime) + insert", async () => {
    await getClient().command({
      query: `CREATE TABLE ${table} (
        website_id String, session_id String, event_name String, created_at DateTime
      ) ENGINE = MergeTree ORDER BY (website_id, created_at)`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });

    await saveEvent({
      website_id: "w_1",
      session_id: "s_1",
      event_name: "pageview",
      created_at: "2026-01-01 00:00:00",
    });

    const rows = await getPageViews(
      "w_1",
      "2026-01-01 00:00:00",
      "2026-12-31 23:59:59",
    );
    expect(rows).toEqual([{ event_name: "pageview", views: "1" }]);
  });
});
