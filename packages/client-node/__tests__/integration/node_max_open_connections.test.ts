import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createSimpleTable } from "@test/fixtures/simple_table";
import { guid } from "@test/utils/guid";
import { sleep } from "@test/utils/sleep";
import type { ClickHouseClient } from "@clickhouse/client";
import { createNodeTestClient } from "../utils/node_client";

describe("[Node.js] max_open_connections config", () => {
  let client: ClickHouseClient;
  let results: number[] = [];

  beforeEach(async () => {
    results = [];
  });

  afterEach(async () => {
    await client.close();
  });

  async function select(query: string) {
    return client
      .query({
        query,
        format: "JSONEachRow",
      })
      .then((r) => r.json<{ x: number }>())
      .then(([{ x }]) => results.push(x));
  }

  it("should use only one connection", async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
    });
    void select("SELECT 1 AS x, sleep(0.3)");
    void select("SELECT 2 AS x, sleep(0.3)");
    while (results.length !== 1) {
      await sleep(100);
    }
    expect(results).toEqual([1]);
    while (results.length === 1) {
      await sleep(100);
    }
    expect(results.sort()).toEqual([1, 2]);
  });

  it("should use only one connection for insert", async () => {
    const tableName = `node_connections_single_connection_insert_${guid()}`;
    // The table is created with default timeouts: on ClickHouse Cloud the DDL
    // alone can take longer than the short request_timeout used below.
    const ddlClient = createNodeTestClient();
    await createSimpleTable(ddlClient, tableName);
    await ddlClient.close();

    // With a single connection, an insert that keeps holding the socket makes
    // the next insert wait for it and fail with a request timeout.
    client = createNodeTestClient({
      max_open_connections: 1,
      request_timeout: 3000,
    });

    const value1 = { id: "42", name: "hello", sku: [0, 1] };
    const value2 = { id: "43", name: "hello", sku: [0, 1] };
    function insert(value: object) {
      return client.insert({
        table: tableName,
        values: [value],
        format: "JSONEachRow",
      });
    }
    await insert(value1);
    await insert(value2); // if previous call holds the socket, the test will time out

    const result = await client.query({
      query: `SELECT * FROM ${tableName}`,
      format: "JSONEachRow",
    });

    const json = await result.json();
    expect(json).toContainEqual(value1);
    expect(json).toContainEqual(value2);
    expect(json.length).toEqual(2);
  });

  it("should use several connections", async () => {
    client = createNodeTestClient({
      max_open_connections: 2,
    });
    void select("SELECT 1 AS x, sleep(0.3)");
    void select("SELECT 2 AS x, sleep(0.3)");
    void select("SELECT 3 AS x, sleep(0.3)");
    void select("SELECT 4 AS x, sleep(0.3)");
    while (results.length < 2) {
      await sleep(100);
    }
    expect(results.sort()).toEqual([1, 2]);
    while (results.length < 4) {
      await sleep(100);
    }
    expect(results.sort()).toEqual([1, 2, 3, 4]);
  });
});
