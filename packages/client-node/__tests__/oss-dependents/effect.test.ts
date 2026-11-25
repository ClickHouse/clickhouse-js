/**
 * Effect-TS/effect — ClickHouse JS client usage example
 * =====================================================
 *
 *   Repo:        https://github.com/Effect-TS/effect  (~14k★)
 *   Package:     @clickhouse/client  ^1.6.0
 *   Lives in:    packages/sql-clickhouse
 *   Analysed at: 18762540d77a79006a1cf88a78ef92c7e072b8e2
 *
 * How the client is used
 * ----------------------
 * `@effect/sql-clickhouse` is the official ClickHouse adapter for Effect's
 * `@effect/sql` abstraction. It wraps the whole client module to expose an
 * Effect-native, resource-safe SQL client with streaming.
 *
 * Key patterns:
 *   - `import * as Clickhouse from "@clickhouse/client"` (whole-module import
 *     wrapped behind an Effect `Client`).
 *   - Integrates @effect/sql/SqlClient, @effect/platform-node/NodeStream and
 *     @effect/experimental/Reactivity (omitted — we reproduce the
 *     acquire/use/release lifecycle the adapter manages).
 *   - The client lifecycle is managed as an Effect resource (scoped
 *     acquire/release).
 *
 * References (pinned to ref=18762540d77a79006a1cf88a78ef92c7e072b8e2):
 *   - Adapter:    https://github.com/Effect-TS/effect/blob/18762540d77a79006a1cf88a78ef92c7e072b8e2/packages/sql-clickhouse/src/ClickhouseClient.ts
 *   - Dependency: https://github.com/Effect-TS/effect/blob/18762540d77a79006a1cf88a78ef92c7e072b8e2/packages/sql-clickhouse/package.json
 *
 * Reproduction note: the adapter acquires via `Clickhouse.createClient`; here the
 * scoped resource is acquired through the test helper so it targets the test
 * server. The whole-module import and acquire/use/release lifecycle are exercised.
 */

import { describe, expect, it } from "vitest";
// Whole-module import, exactly as the @effect/sql adapter does.
import * as Clickhouse from "@clickhouse/client";
import { createTestClient } from "@test/utils";

describe("oss-dependents / effect", () => {
  // The adapter manages the client as a scoped resource (acquire/release).
  function acquire(): Clickhouse.ClickHouseClient {
    return createTestClient();
  }

  async function release(client: Clickhouse.ClickHouseClient): Promise<void> {
    await client.close();
  }

  // `use` runs work within the resource scope, guaranteeing release.
  async function scoped<A>(
    use: (client: Clickhouse.ClickHouseClient) => Promise<A>,
  ): Promise<A> {
    const client = acquire();
    try {
      return await use(client);
    } finally {
      await release(client);
    }
  }

  it("whole-module import + scoped acquire/use/release", async () => {
    expect(typeof Clickhouse.createClient).toBe("function");
    const rows = await scoped(async (client) => {
      const result = await client.query({
        query: "SELECT 1 AS one",
        format: "JSONEachRow",
      });
      return result.json<{ one: number }>();
    });
    expect(rows).toEqual([{ one: 1 }]);
  });
});
