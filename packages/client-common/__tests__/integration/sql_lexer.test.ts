import { describe, it, expect, afterEach, beforeEach } from "vitest";
import * as lexer from "@clickhouse/lexer";
import { type ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient } from "../utils";

describe("sql_lexer", () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });
  beforeEach(async () => {
    client = createTestClient({ sql_lexer: lexer });
  });

  // https://github.com/ClickHouse/clickhouse-js/issues/973
  it.each([
    "SELECT 13 AS a; -- trailing comment",
    "SELECT 13 AS a;\n-- trailing comment",
    "SELECT 13 AS a; /* trailing comment */",
    "SELECT 13 AS a; # trailing comment",
  ])("query() accepts a semicolon before a comment: %j", async (query) => {
    const rs = await client.query({ query, format: "JSONEachRow" });
    expect(await rs.json()).toEqual([{ a: 13 }]);
  });

  it("query() keeps a semicolon inside a string literal", async () => {
    const rs = await client.query({
      query: "SELECT ';' AS a; -- trailing comment",
      format: "JSONEachRow",
    });
    expect(await rs.json()).toEqual([{ a: ";" }]);
  });

  it("command() accepts a semicolon before a comment", async () => {
    await expect(
      client.command({ query: "SELECT 1; -- trailing comment" }),
    ).resolves.toBeDefined();
  });
});
