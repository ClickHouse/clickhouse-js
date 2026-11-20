import { describe, it, expect } from "vitest";
import { ClickHouseClient, type InsertParams } from "../../src/client";

// Builds a client whose connection records the generated `INSERT` statement,
// so we can assert the exact SQL produced by `client.insert(...)` (i.e. the
// real getInsertQuery code path) without a running server.
function createQueryCapturingClient(): {
  client: ClickHouseClient;
  getLastQuery: () => string | undefined;
} {
  let lastQuery: string | undefined;
  const connection = {
    query: async () => ({ stream: {}, query_id: "q", response_headers: {} }),
    command: async () => ({ query_id: "c", response_headers: {} }),
    exec: async () => ({ stream: {}, query_id: "e", response_headers: {} }),
    insert: async (params: { query: string }) => {
      lastQuery = params.query;
      return { query_id: "i", response_headers: {} };
    },
    ping: async () => ({ success: true }),
    close: async () => {},
  };
  const client = new ClickHouseClient({
    url: "http://localhost:8123",
    impl: {
      make_connection: () => connection as any,
      make_result_set: (() => ({})) as any,
      values_encoder: () =>
        ({
          validateInsertValues: () => {},
          encodeValues: (v: any) =>
            typeof v === "string" ? v : JSON.stringify(v),
        }) as any,
    },
  } as any);
  return { client, getLastQuery: () => lastQuery };
}

async function insertColumns(
  columns: InsertParams["columns"],
): Promise<string> {
  const { client, getLastQuery } = createQueryCapturingClient();
  await client.insert({
    table: "t",
    values: [{ id: 1 }],
    format: "JSONEachRow",
    columns,
  });
  return getLastQuery()!;
}

describe("getInsertQuery column identifier quoting", () => {
  describe("list of columns", () => {
    const cases: Array<{
      title: string;
      columns: [string, ...string[]];
      expected: string;
    }> = [
      {
        title: "back-quotes plain identifiers",
        columns: ["id", "name"],
        expected: "INSERT INTO t (`id`, `name`) FORMAT JSONEachRow",
      },
      {
        title: "back-quotes identifiers containing spaces (#945)",
        columns: ["test id", "name"],
        expected: "INSERT INTO t (`test id`, `name`) FORMAT JSONEachRow",
      },
      {
        title: "escapes an embedded backtick with a backslash",
        columns: ["a`b"],
        expected: "INSERT INTO t (`a\\`b`) FORMAT JSONEachRow",
      },
      {
        title: "escapes an embedded backslash",
        columns: ["a\\b"],
        expected: "INSERT INTO t (`a\\\\b`) FORMAT JSONEachRow",
      },
      {
        // Both special chars in one name: pins that the backslash is escaped
        // before the backtick (reversing the order would emit invalid SQL).
        title: "escapes a name containing both a backslash and a backtick",
        columns: ["a\\`b"],
        expected: "INSERT INTO t (`a\\\\\\`b`) FORMAT JSONEachRow",
      },
      {
        // A lone backtick is a 1-char name, below the passthrough guard, so it
        // is escaped rather than mistaken for an already-quoted identifier.
        title: "escapes a single-backtick column name (passthrough boundary)",
        columns: ["`"],
        expected: "INSERT INTO t (`\\``) FORMAT JSONEachRow",
      },
      {
        title: "back-quotes a dotted (Nested) column as a single identifier",
        columns: ["n.arr1", "n.arr2"],
        expected: "INSERT INTO t (`n.arr1`, `n.arr2`) FORMAT JSONEachRow",
      },
      {
        // Contrast case: an already back-quoted identifier (the pre-#945
        // workaround) must be passed through unchanged, not double-quoted.
        title: "passes through already back-quoted identifiers unchanged",
        columns: ["`test id`", "name"],
        expected: "INSERT INTO t (`test id`, `name`) FORMAT JSONEachRow",
      },
      {
        // Contrast case: double-quoted identifiers are also valid ClickHouse
        // syntax and are passed through unchanged.
        title: "passes through already double-quoted identifiers unchanged",
        columns: ['"test id"', "name"],
        expected: 'INSERT INTO t ("test id", `name`) FORMAT JSONEachRow',
      },
    ];

    it.each(cases)("$title", async ({ columns, expected }) => {
      expect(await insertColumns(columns)).toBe(expected);
    });
  });

  describe("EXCEPT list of columns", () => {
    const cases: Array<{
      title: string;
      columns: { except: [string, ...string[]] };
      expected: string;
    }> = [
      {
        title: "back-quotes excepted identifiers containing spaces",
        columns: { except: ["test col"] },
        expected: "INSERT INTO t (* EXCEPT (`test col`)) FORMAT JSONEachRow",
      },
      {
        title: "back-quotes multiple excepted identifiers",
        columns: { except: ["id", "b"] },
        expected: "INSERT INTO t (* EXCEPT (`id`, `b`)) FORMAT JSONEachRow",
      },
      {
        // Contrast case: already back-quoted excepted identifier is unchanged.
        title: "passes through already back-quoted excepted identifiers",
        columns: { except: ["`test col`"] },
        expected: "INSERT INTO t (* EXCEPT (`test col`)) FORMAT JSONEachRow",
      },
    ];

    it.each(cases)("$title", async ({ columns, expected }) => {
      expect(await insertColumns(columns)).toBe(expected);
    });
  });
});
