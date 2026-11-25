/**
 * civitai/civitai — ClickHouse JS client usage example
 * ====================================================
 *
 *   Repo:        https://github.com/civitai/civitai  (~7k★)
 *   Package:     @clickhouse/client  ^0.2.2 (notably old — pre-1.0)
 *   Lives in:    src/server/clickhouse/client.ts
 *   Analysed at: dfbd42ac3b2809610e12e749f24f35159d057bfa
 *
 * How the client is used
 * ----------------------
 * Civitai uses ClickHouse for METRICS, REWARDS and event tracking. A
 * `CustomClickHouseClient` wraps `createClient`; downstream modules build
 * metrics, rewards and event jobs on top of it.
 *
 * Key patterns:
 *   - `import { createClient, type ClickHouseClient } from '@clickhouse/client'`.
 *   - A `CustomClickHouseClient` augmentation reused across metrics/rewards.
 *   - Error handling via `ClickHouseError`.
 *
 * Outlier: upstream is still on @clickhouse/client@^0.2.2, so it predates a large
 * amount of the current API surface — a good migration candidate. This example
 * targets the CURRENT (1.x) API on purpose, so the integration test reflects
 * where civitai would land after upgrading.
 *
 * References (pinned to ref=dfbd42ac3b2809610e12e749f24f35159d057bfa):
 *   - Client wrapper: https://github.com/civitai/civitai/blob/dfbd42ac3b2809610e12e749f24f35159d057bfa/src/server/clickhouse/client.ts
 *   - Metrics base:   https://github.com/civitai/civitai/blob/dfbd42ac3b2809610e12e749f24f35159d057bfa/src/server/metrics/base.metrics.ts
 *   - Error handling: https://github.com/civitai/civitai/blob/dfbd42ac3b2809610e12e749f24f35159d057bfa/src/server/jobs/images-created-events.ts
 *   - Dependency:     https://github.com/civitai/civitai/blob/dfbd42ac3b2809610e12e749f24f35159d057bfa/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ClickHouseError, type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

describe("oss-dependents / civitai", () => {
  const table = `oss_civitai_${guid()}`;

  // CustomClickHouseClient augments the base client with domain helpers reused by
  // metrics and rewards modules.
  class CustomClickHouseClient {
    private client: ClickHouseClient;
    lastError: ClickHouseError | null = null;
    constructor() {
      this.client = createTestClient();
    }

    async createSchema(): Promise<void> {
      await this.client.command({
        query: `CREATE TABLE ${table} (type String, userId UInt32) ENGINE = MergeTree ORDER BY type`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
    }

    async trackEvent(
      target: string,
      event: { type: string; userId: number },
    ): Promise<boolean> {
      try {
        await this.client.insert({
          table: target,
          values: [event],
          format: "JSONEachRow",
        });
        return true;
      } catch (err) {
        // Civitai narrows ClickHouse-specific failures from generic ones.
        if (err instanceof ClickHouseError) {
          this.lastError = err;
          return false;
        }
        throw err;
      }
    }

    async count(): Promise<string> {
      const rows = await (
        await this.client.query({
          query: `SELECT count() AS n FROM ${table}`,
          format: "JSONEachRow",
        })
      ).json<{ n: string }>();
      return rows[0]!.n;
    }

    async close(): Promise<void> {
      await this.client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await this.client.close();
    }
  }

  let ch: CustomClickHouseClient;
  afterEach(async () => {
    await ch.close();
  });

  it("tracks events and narrows ClickHouseError on failure", async () => {
    ch = new CustomClickHouseClient();
    await ch.createSchema();

    // Happy path.
    expect(
      await ch.trackEvent(table, { type: "image.created", userId: 1 }),
    ).toBe(true);
    expect(await ch.count()).toBe("1");

    // Failure path: inserting into a missing table surfaces a ClickHouseError,
    // which the wrapper catches and narrows (instanceof) rather than crashing.
    expect(
      await ch.trackEvent(`missing_${guid()}`, {
        type: "image.created",
        userId: 2,
      }),
    ).toBe(false);
    expect(ch.lastError).toBeInstanceOf(ClickHouseError);
    expect(typeof ch.lastError?.code).toBe("string");
  });
});
