/**
 * arkime/arkime — ClickHouse JS client usage example
 * ==================================================
 *
 *   Repo:        https://github.com/arkime/arkime  (~7k★)
 *   Package:     @clickhouse/client  ^1.12.1
 *   Lives in:    cont3xt/integrations/clickhouse
 *   Analysed at: dc5bd802e1b071d4a54993ceb2fd2b42677c917b
 *
 * How the client is used
 * ----------------------
 * Arkime is a large-scale network-capture/indexing system. The JS client
 * appears in Cont3xt, Arkime's threat-intel enrichment UI, as a pluggable
 * `ClickHouseIntegration` — analysts configure a query that ClickHouse runs to
 * enrich an indicator (IP/domain/etc.).
 *
 * Key patterns:
 *   - Upstream is CommonJS: `const { createClient } = require('@clickhouse/client')`.
 *     Reproduced here with an ESM import (the runtime surface is identical).
 *   - `class ClickHouseIntegration extends Integration` — implements the
 *     integration contract and runs user-configured queries.
 *
 * References (pinned to ref=dc5bd802e1b071d4a54993ceb2fd2b42677c917b):
 *   - Integration: https://github.com/arkime/arkime/blob/dc5bd802e1b071d4a54993ceb2fd2b42677c917b/cont3xt/integrations/clickhouse/index.js
 *   - Dependency:  https://github.com/arkime/arkime/blob/dc5bd802e1b071d4a54993ceb2fd2b42677c917b/package.json
 *
 * Reproduction targets the current 1.x API and runs against the test ClickHouse.
 */

import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

// Minimal stand-in for Cont3xt's Integration base class.
abstract class Integration {
  abstract fetch(
    query: string,
    params: Record<string, unknown>,
  ): Promise<unknown>;
}

describe("oss-dependents / arkime", () => {
  const table = `oss_arkime_${guid()}`;

  class ClickHouseIntegration extends Integration {
    private client: ClickHouseClient;
    constructor() {
      super();
      this.client = createTestClient();
    }

    // Runs the analyst-configured enrichment query for an indicator.
    async fetch(
      query: string,
      params: Record<string, unknown>,
    ): Promise<unknown[]> {
      const result = await this.client.query({
        query,
        query_params: params,
        format: "JSONEachRow",
      });
      return result.json();
    }

    async seed(): Promise<void> {
      await this.client.command({
        query: `CREATE TABLE ${table} (indicator String, score UInt32) ENGINE = MergeTree ORDER BY indicator`,
        clickhouse_settings: { wait_end_of_query: 1 },
      });
      await this.client.insert({
        table,
        values: [{ indicator: "1.2.3.4", score: 42 }],
        format: "JSONEachRow",
      });
    }

    async close(): Promise<void> {
      await this.client.command({ query: `DROP TABLE IF EXISTS ${table}` });
      await this.client.close();
    }
  }

  let integration: ClickHouseIntegration;
  afterEach(async () => {
    await integration.close();
  });

  it("integration class runs a parameterised enrichment query", async () => {
    integration = new ClickHouseIntegration();
    await integration.seed();
    const rows = await integration.fetch(
      `SELECT indicator, score FROM ${table} WHERE indicator = {indicator:String}`,
      { indicator: "1.2.3.4" },
    );
    expect(rows).toEqual([{ indicator: "1.2.3.4", score: 42 }]);
  });
});
