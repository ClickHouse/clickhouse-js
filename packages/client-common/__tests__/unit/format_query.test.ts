import { describe, it, expect } from "vitest";
import type { DataFormat } from "../../src/index";
import { ClickHouseClient } from "../../src/client";

/** Builds a client whose connection records the final wire query string passed
 *  to `connection.query()`, so we can assert exactly how `client.query()`
 *  assembles the `FORMAT` clause — in particular, where it places `FORMAT`
 *  relative to a user-supplied trailing `SETTINGS` clause (see #970). */
function createCapturingClient(): {
  client: ClickHouseClient;
  lastQuery: () => string;
} {
  let captured = "";
  const client = new ClickHouseClient({
    url: "http://localhost:8123",
    impl: {
      make_connection: () =>
        ({
          query: async (params: { query: string }) => {
            captured = params.query;
            return {
              stream: {} as any,
              query_id: "q-1",
              response_headers: {},
            };
          },
          close: async () => {},
        }) as any,
      make_result_set: () => ({}) as any,
      values_encoder: () => ({}) as any,
    },
  });
  return { client, lastQuery: () => captured };
}

async function wireQuery(query: string, format?: DataFormat): Promise<string> {
  const { client, lastQuery } = createCapturingClient();
  await client.query({ query, format });
  return lastQuery();
}

describe("client.query FORMAT clause placement (#970)", () => {
  it.each([
    {
      name: "appends FORMAT at the end when there is no trailing SETTINGS clause",
      query: "SELECT 1",
      format: undefined,
      expected: "SELECT 1 \nFORMAT JSON",
    },
    {
      name: "injects FORMAT before a trailing SETTINGS clause instead of after it",
      query: "SELECT * FROM t WHERE a = 1 SETTINGS max_threads = 1",
      format: "JSONEachRow" as DataFormat,
      expected:
        "SELECT * FROM t WHERE a = 1 \nFORMAT JSONEachRow SETTINGS max_threads = 1",
    },
    {
      name: "handles the DESC format(...) reproduction from the issue",
      query:
        "DESC format(JSONEachRow, '{\"id\":1}') SETTINGS schema_inference_hints = 'age LowCardinality(UInt8)', allow_suspicious_low_cardinality_types = 1",
      format: "JSONEachRow" as DataFormat,
      expected:
        "DESC format(JSONEachRow, '{\"id\":1}') \nFORMAT JSONEachRow SETTINGS schema_inference_hints = 'age LowCardinality(UInt8)', allow_suspicious_low_cardinality_types = 1",
    },
    {
      name: "ignores the word SETTINGS inside a string literal",
      query: "SELECT 'a SETTINGS b' AS x",
      format: undefined,
      expected: "SELECT 'a SETTINGS b' AS x \nFORMAT JSON",
    },
    {
      name: "ignores a settings identifier that is not a SETTINGS clause",
      query: "SELECT name FROM system.settings",
      format: undefined,
      expected: "SELECT name FROM system.settings \nFORMAT JSON",
    },
    {
      name: "does not treat a subquery's own SETTINGS clause as trailing",
      query: "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1)",
      format: undefined,
      expected:
        "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1) \nFORMAT JSON",
    },
    {
      name: "injects FORMAT before the outer trailing SETTINGS, not the subquery's",
      query:
        "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1) SETTINGS max_block_size = 100",
      format: undefined,
      expected:
        "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1) \nFORMAT JSON SETTINGS max_block_size = 100",
    },
    {
      name: "ignores SETTINGS inside a line comment",
      query: "SELECT 1 -- SETTINGS x = 1",
      format: undefined,
      expected: "SELECT 1 -- SETTINGS x = 1 \nFORMAT JSON",
    },
    {
      name: "ignores SETTINGS inside a block comment but honors a real trailing clause after it",
      query: "SELECT 1 /* SETTINGS y = 2 */ SETTINGS max_threads = 1",
      format: undefined,
      expected:
        "SELECT 1 /* SETTINGS y = 2 */ \nFORMAT JSON SETTINGS max_threads = 1",
    },
    {
      name: "strips a trailing semicolon before placing the FORMAT clause",
      query: "SELECT 1 SETTINGS max_threads = 1;",
      format: undefined,
      expected: "SELECT 1 \nFORMAT JSON SETTINGS max_threads = 1",
    },
    {
      name: "ignores SETTINGS inside a line comment",
      query: "SELECT 1 # SETTINGS z = 3",
      format: undefined,
      expected: "SELECT 1 # SETTINGS z = 3 \nFORMAT JSON",
    },
    {
      name: "ignores SETTINGS inside a dollar-quoted (heredoc) string literal",
      query: "SELECT $$a SETTINGS x = 1$$ AS c",
      format: undefined,
      expected: "SELECT $$a SETTINGS x = 1$$ AS c \nFORMAT JSON",
    },
    {
      name: "skips a tagged heredoc yet still injects before a real trailing SETTINGS clause",
      query: "SELECT $q$a SETTINGS y = 2$q$ AS c SETTINGS max_threads = 1",
      format: undefined,
      expected:
        "SELECT $q$a SETTINGS y = 2$q$ AS c \nFORMAT JSON SETTINGS max_threads = 1",
    },
    {
      name: "detects a SETTINGS clause with no spaces around the equals sign",
      query: "SELECT 1 SETTINGS max_threads=1",
      format: undefined,
      expected: "SELECT 1 \nFORMAT JSON SETTINGS max_threads=1",
    },
  ])("$name", async ({ query, format, expected }) => {
    expect(await wireQuery(query, format)).toBe(expected);
  });
});
