/**
 * beekeeper-studio/beekeeper-studio — ClickHouse JS client usage example
 * ======================================================================
 *
 *   Repo:        https://github.com/beekeeper-studio/beekeeper-studio  (~23k★)
 *   Package:     @clickhouse/client  ^1.8.1
 *   Lives in:    apps/studio
 *   Analysed at: 2839d29c544a7a0c5c7e85f6431f7187cf311759
 *
 * How the client is used
 * ----------------------
 * Beekeeper Studio is a cross-platform SQL GUI; ClickHouse is one of its
 * supported engines. The client powers a DATABASE DRIVER plus a custom knex
 * dialect so the app can introspect schemas, run queries and insert data.
 *
 * Key patterns:
 *   - `import { createClient, InsertParams } from '@clickhouse/client'`.
 *   - A bespoke knex-clickhouse layer (TableBuilder, ViewCompiler,
 *     QueryCompiler) wrapping the driver (omitted here).
 *   - TLS handling: one-way and mutual TLS based on configured cert/key files.
 *
 * References (pinned to ref=2839d29c544a7a0c5c7e85f6431f7187cf311759):
 *   - DB client:   https://github.com/beekeeper-studio/beekeeper-studio/blob/2839d29c544a7a0c5c7e85f6431f7187cf311759/apps/studio/src-commercial/backend/lib/db/clients/clickhouse.ts
 *   - knex dialect: https://github.com/beekeeper-studio/beekeeper-studio/blob/2839d29c544a7a0c5c7e85f6431f7187cf311759/apps/studio/src/shared/lib/knex-clickhouse/index.ts
 *   - Dependency:  https://github.com/beekeeper-studio/beekeeper-studio/blob/2839d29c544a7a0c5c7e85f6431f7187cf311759/apps/studio/package.json
 *
 * Reproduction note: the TLS config-builder below is kept (and type-checked)
 * because TLS is a defining part of the upstream driver, but the running client
 * connects over plain HTTP (TLS has its own dedicated test env). The
 * `InsertParams`-typed insert and query surface are exercised live.
 */

import type { Readable } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import { type ClickHouseClient, type InsertParams } from "@clickhouse/client";
import { createTestClient, guid } from "@test/utils";

interface DriverTLS {
  ca_cert: Buffer;
  cert?: Buffer;
  key?: Buffer;
}

describe("oss-dependents / beekeeper-studio", () => {
  let client: ClickHouseClient;
  const table = `oss_beekeeper_${guid()}`;

  // Type-checked stand-in for the driver's one-way / mutual TLS builder. Exercises
  // the shape the upstream driver passes to createClient({ tls }).
  function buildTls(files?: {
    caFile: Buffer;
    certFile?: Buffer;
    keyFile?: Buffer;
  }): DriverTLS | undefined {
    if (!files) return undefined;
    const tls: DriverTLS = { ca_cert: files.caFile };
    if (files.certFile && files.keyFile) {
      tls.cert = files.certFile; // mutual TLS
      tls.key = files.keyFile;
    }
    return tls;
  }

  function createDriver(): ClickHouseClient {
    // In a TLS deployment the result of buildTls() would be passed as `tls`.
    void buildTls;
    return createTestClient();
  }

  // GUI "insert rows" action maps to InsertParams.
  async function insertRows(
    c: ClickHouseClient,
    rows: unknown[],
  ): Promise<void> {
    const params: InsertParams<Readable> = {
      table,
      values: rows,
      format: "JSONEachRow",
    };
    await c.insert(params);
  }

  afterEach(async () => {
    await client.command({ query: `DROP TABLE IF EXISTS ${table}` });
    await client.close();
  });

  it("InsertParams-typed insert + SHOW TABLES introspection", async () => {
    client = createDriver();
    await client.command({
      query: `CREATE TABLE ${table} (id UInt32) ENGINE = MergeTree ORDER BY id`,
      clickhouse_settings: { wait_end_of_query: 1 },
    });
    await insertRows(client, [{ id: 1 }]);

    const tables = await (
      await client.query({ query: "SHOW TABLES", format: "JSONEachRow" })
    ).json<{ name: string }>();
    expect(tables.some((t) => t.name === table)).toBe(true);

    const rows = await (
      await client.query({
        query: `SELECT id FROM ${table}`,
        format: "JSONEachRow",
      })
    ).json<{ id: number }>();
    expect(rows).toEqual([{ id: 1 }]);
  });
});
