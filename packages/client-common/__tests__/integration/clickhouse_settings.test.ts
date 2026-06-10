import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type {
  ClickHouseClient,
  ClickHouseSettings,
  InsertParams,
} from "@clickhouse/client-common";
import { SettingsMap } from "@clickhouse/client-common";
import { createSimpleTable } from "../fixtures/simple_table";
import { createTestClient, guid, isOnEnv, TestEnv } from "../utils";

describe("ClickHouse settings", () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  // Guards against transport/serialization regressions: the client must be able
  // to send any setting the server advertises (including enum and Map settings).
  // Scoped to local environments, where every setting is writable, so we can
  // assert that none of them is rejected when sent back at its current value.
  it.skipIf(!isOnEnv(TestEnv.LocalSingleNode, TestEnv.LocalCluster))(
    "should be able to send every setting reported by system.settings",
    async () => {
      const settings = await client
        .query({
          query: "SELECT name, value FROM system.settings",
          format: "JSONEachRow",
        })
        .then((r) => r.json<{ name: string; value: string }>());
      expect(settings.length).toBeGreaterThan(0);

      const failures: { name: string; error: string }[] = [];
      const concurrency = 10;
      let index = 0;
      async function worker() {
        while (index < settings.length) {
          const { name, value } = settings[index++];
          try {
            await client.command({
              query: "SELECT 1",
              clickhouse_settings: { [name]: value } as ClickHouseSettings,
            });
          } catch (err) {
            failures.push({ name, error: (err as Error).message });
          }
        }
      }
      await Promise.all(Array.from({ length: concurrency }, () => worker()));
      expect(failures).toEqual([]);
    },
  );

  it("should work with additional_table_filters map", async () => {
    const result = await client
      .query({
        query: "SELECT * FROM system.numbers LIMIT 5",
        format: "CSV",
        clickhouse_settings: {
          additional_table_filters: SettingsMap.from({
            "system.numbers": "number != 3",
          }),
        },
      })
      .then((r) => r.text());
    expect(result).toEqual("0\n1\n2\n4\n5\n");
  });

  // covers both command and insert settings behavior
  // `insert_deduplication_token` will not work without
  // `non_replicated_deduplication_window` merge tree table setting
  // on a single node ClickHouse (but will work on cluster)
  it("should work with insert_deduplication_token", async () => {
    const tableName = `clickhouse_settings_insert__${guid()}`;
    await createSimpleTable(client, tableName, {
      non_replicated_deduplication_window: "5",
    });
    const params: InsertParams = {
      table: tableName,
      values: [{ id: "1", name: "foobar", sku: [1, 2] }],
      format: "JSONEachRow",
    };
    // See https://clickhouse.com/docs/en/operations/settings/settings/#insert_deduplication_token
    await client.insert({
      // #1
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: "foo",
      },
    });
    await client.insert({
      // #2
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: "foo",
      },
    });
    await client.insert({
      // #3
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: "bar",
      },
    });
    // we will end up with two records since #2
    // is deduplicated due to the same token
    expect(
      await client
        .query({
          query: `SELECT * FROM ${tableName}`,
          format: "JSONEachRow",
        })
        .then((r) => r.json()),
    ).toEqual([
      { id: "1", name: "foobar", sku: [1, 2] },
      { id: "1", name: "foobar", sku: [1, 2] },
    ]);
  });
});
