/**
 * rybbit-io/rybbit — ClickHouse JS client usage example
 * =====================================================
 *
 *   Repo:        https://github.com/rybbit-io/rybbit  (~12k★)
 *   Package:     @clickhouse/client  1.11.1 (pinned, exact)
 *   Lives in:    server/src/db/clickhouse
 *   Analysed at: d92e3f274121f1910c9259747c8045bd74a21792
 *
 * How the client is used
 * ----------------------
 * Rybbit is an open-source web/product-analytics platform; ClickHouse is its
 * event store. A single `clickhouse.ts` module creates the client and an
 * `initializeClickhouse()` routine bootstraps the ENTIRE SCHEMA — base tables,
 * `ALTER TABLE` migrations, and a large set of MATERIALIZED VIEWS (streaming and
 * `REFRESH EVERY` refreshable MVs) that power the dashboard.
 *
 * Key patterns:
 *   - `createClient({ url, database, password, request_timeout: 300_000 })` —
 *     long request timeout for heavy queries.
 *   - Schema/DDL applied entirely through `client.exec({ query,
 *     clickhouse_settings })`.
 *   - `ResultSet` type used in query utilities; deployment flags (IS_CLOUD,
 *     LITE_DASHBOARD) toggle which MVs are created.
 *
 * References (pinned to ref=d92e3f274121f1910c9259747c8045bd74a21792):
 *   - Client + bootstrap: https://github.com/rybbit-io/rybbit/blob/d92e3f274121f1910c9259747c8045bd74a21792/server/src/db/clickhouse/clickhouse.ts
 *   - Query utils:        https://github.com/rybbit-io/rybbit/blob/d92e3f274121f1910c9259747c8045bd74a21792/server/src/api/analytics/utils/utils.ts
 *   - Dependency:         https://github.com/rybbit-io/rybbit/blob/d92e3f274121f1910c9259747c8045bd74a21792/server/package.json
 *
 * Reproduction note: upstream uses a `REFRESH EVERY ...` refreshable MV (an
 * experimental feature). To keep the test portable across server versions we use
 * a standard incremental MV (`POPULATE`); the surface under test — DDL via
 * `exec`, `request_timeout`, and `ResultSet` — is unchanged.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient, type ResultSet } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / rybbit", () => {
  let client: ClickHouseClient;
  const events = `oss_rybbit_events_${guid()}`;
  const mv = `oss_rybbit_events_hourly_${guid()}`;

  // initializeClickhouse() — all DDL applied via client.exec().
  async function initializeClickhouse(): Promise<void> {
    const ddl = [
      `CREATE TABLE IF NOT EXISTS ${events} (
         site_id UInt32, type String, timestamp DateTime
       ) ENGINE = MergeTree ORDER BY (site_id, timestamp)`,
      // A materialized view powering the dashboard.
      `CREATE MATERIALIZED VIEW IF NOT EXISTS ${mv}
       ENGINE = SummingMergeTree ORDER BY (site_id, hour) POPULATE AS
       SELECT site_id, toStartOfHour(timestamp) AS hour, count() AS hits
       FROM ${events} GROUP BY site_id, hour`,
    ];
    for (const query of ddl) {
      const { stream } = await client.exec({
        query,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      stream.destroy();
    }
  }

  // Query utility typed against ResultSet.
  async function rawQuery(query: string): Promise<ResultSet<"JSONEachRow">> {
    return client.query({ query, format: "JSONEachRow" });
  }

  afterEach(async () => {
    await client.command({ query: `DROP VIEW IF EXISTS ${mv}` });
    await client.command({ query: `DROP TABLE IF EXISTS ${events}` });
    await client.close();
  });

  it("exec-based DDL + materialized view, ResultSet query util", async () => {
    client = createTestClient({ request_timeout: 300_000 });
    await initializeClickhouse();

    await client.insert({
      table: events,
      values: [
        { site_id: 1, type: "pageview", timestamp: "2026-01-01 00:00:00" },
        { site_id: 1, type: "pageview", timestamp: "2026-01-01 00:30:00" },
      ],
      format: "JSONEachRow",
    });

    const result = await rawQuery(`SELECT count() AS n FROM ${events}`);
    expect(await result.json<{ n: string }>()).toEqual([{ n: "2" }]);

    // The MV aggregated both events into a single hourly bucket.
    const hourly = await rawQuery(`SELECT sum(hits) AS hits FROM ${mv}`);
    expect(await hourly.json<{ hits: string }>()).toEqual([{ hits: "2" }]);
  });
});
