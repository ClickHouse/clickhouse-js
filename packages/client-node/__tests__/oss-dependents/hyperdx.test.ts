/**
 * hyperdxio/hyperdx — ClickHouse JS client usage example
 * ======================================================
 *
 *   Repo:        https://github.com/hyperdxio/hyperdx  (~9k★)
 *   Packages:    @clickhouse/client, @clickhouse/client-web, @clickhouse/client-common
 *                — all ^1.12.1
 *   Lives in:    packages/common-utils/src/clickhouse
 *   Analysed at: 34aa906f0a102acbb66a49e91b1a5267070d3546
 *   Test partner: release-test branch clickhouse-js-client-release-test
 *                 (https://github.com/hyperdxio/hyperdx/pull/1553)
 *
 * How the client is used
 * ----------------------
 * HyperDX is an observability UI over ClickHouse and is the ONLY repo in this
 * set that uses the BROWSER client (@clickhouse/client-web). The `common-utils`
 * package deliberately decouples node and browser implementations behind a
 * shared base, using common types from @clickhouse/client-common.
 *
 * Key patterns:
 *   - clickhouse/node.ts    -> createClient from @clickhouse/client
 *   - clickhouse/browser.ts -> createClient from @clickhouse/client-web
 *   - index.ts unifies both (NodeClickHouseClient vs WebClickHouseClient) using
 *     shared types from @clickhouse/client-common.
 *   - A `getJSNativeCreateClient` indirection so app/api packages don't import
 *     the client directly.
 *
 * References (pinned to ref=34aa906f0a102acbb66a49e91b1a5267070d3546):
 *   - Node client:    https://github.com/hyperdxio/hyperdx/blob/34aa906f0a102acbb66a49e91b1a5267070d3546/packages/common-utils/src/clickhouse/node.ts
 *   - Browser client: https://github.com/hyperdxio/hyperdx/blob/34aa906f0a102acbb66a49e91b1a5267070d3546/packages/common-utils/src/clickhouse/browser.ts
 *   - Unified index:  https://github.com/hyperdxio/hyperdx/blob/34aa906f0a102acbb66a49e91b1a5267070d3546/packages/common-utils/src/clickhouse/index.ts
 *   - Dependency:     https://github.com/hyperdxio/hyperdx/blob/34aa906f0a102acbb66a49e91b1a5267070d3546/packages/common-utils/package.json
 *
 * Reproduction note: the node path runs through the shared `createTestClient`
 * (works on every test environment). The browser path is constructed from the
 * public `@clickhouse/client-web` surface and, on local environments, also runs a
 * trivial query (the web client works under Node via global `fetch`).
 */

import { afterEach, describe, expect, it } from "vitest";
// Shared, environment-agnostic types come from the -common package.
import type { ClickHouseSettings } from "@clickhouse/client-common";
import { type ClickHouseClient as NodeClickHouseClient } from "@clickhouse/client";
import {
  createClient as createWebClient,
  type ClickHouseClient as WebClickHouseClient,
} from "@clickhouse/client-web";
import {
  createTestClient,
  getClickHouseTestEnvironment,
  TestEnv,
} from "@test/utils";

interface BaseClientOptions {
  url: string;
  database?: string;
  clickhouse_settings?: ClickHouseSettings;
}

describe("oss-dependents / hyperdx", () => {
  let nodeClient: NodeClickHouseClient;
  let webClient: WebClickHouseClient | undefined;

  // clickhouse/node.ts — node path uses the shared test client.
  function createNodeClickHouseClient(): NodeClickHouseClient {
    return createTestClient();
  }

  // clickhouse/browser.ts — browser path uses @clickhouse/client-web.
  function createBrowserClickHouseClient(
    options: BaseClientOptions,
  ): WebClickHouseClient {
    return createWebClient(options);
  }

  afterEach(async () => {
    await nodeClient.close();
    await webClient?.close();
  });

  it("unifies node + browser clients behind a shared surface", async () => {
    // Node path (runs on every environment).
    nodeClient = createNodeClickHouseClient();
    const nodeRows = await (
      await nodeClient.query({ query: "SELECT 1 AS ok", format: "JSONEachRow" })
    ).json<{ ok: number }>();
    expect(nodeRows).toEqual([{ ok: 1 }]);

    // Browser path: construct from the public web surface to guard its exports.
    const env = getClickHouseTestEnvironment();
    const url =
      env === TestEnv.LocalCluster
        ? "http://127.0.0.1:8127"
        : "http://127.0.0.1:8123";
    webClient = createBrowserClickHouseClient({ url });
    expect(webClient).toBeDefined();

    // The web client also runs under Node, so exercise it on local environments.
    if (env !== TestEnv.Cloud) {
      const webRows = await (
        await webClient.query({
          query: "SELECT 2 AS ok",
          format: "JSONEachRow",
        })
      ).json<{ ok: number }>();
      expect(webRows).toEqual([{ ok: 2 }]);
    }
  });
});
