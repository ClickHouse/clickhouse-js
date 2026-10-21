import { describe, it, expect } from "vitest";
import type { DataFormat } from "@clickhouse/client-common";
import { ClickHouseClient } from "../../src/client";

// Pins the exact SQL text that query(), command() and exec() hand to the
// connection, so that changes to how the client rewrites user SQL
// (trailing semicolons, the appended FORMAT clause) are always deliberate.

function buildCapturingClient() {
  const sent: string[] = [];
  const capture = async (params: { query: string }) => {
    sent.push(params.query);
    return {
      stream: {} as any,
      query_id: "q-1",
      response_headers: {},
    };
  };
  const connection = {
    query: capture,
    command: capture,
    exec: capture,
    insert: capture,
    ping: async () => ({ success: true }),
    close: async () => {},
  };
  const client = new ClickHouseClient({
    url: "http://localhost:8123",
    impl: {
      make_connection: () => connection as any,
      make_result_set: (() => ({})) as any,
      values_encoder: () => ({}) as any,
    },
  });
  return { client, sent };
}

async function sentByQuery(
  query: string,
  format: DataFormat = "JSON",
): Promise<string> {
  const { client, sent } = buildCapturingClient();
  await client.query({ query, format });
  return sent[0];
}

async function sentByCommand(query: string): Promise<string> {
  const { client, sent } = buildCapturingClient();
  await client.command({ query });
  return sent[0];
}

async function sentByExec(query: string): Promise<string> {
  const { client, sent } = buildCapturingClient();
  await client.exec({ query });
  return sent[0];
}

describe("SQL rewriting", () => {
  describe("query() appends FORMAT", () => {
    it.each([
      ["SELECT 1", "SELECT 1 \nFORMAT JSON"],
      ["  SELECT 1  \n", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;;;", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;\n", "SELECT 1 \nFORMAT JSON"],
      // Whitespace before the semicolon is kept, hence the double space.
      ["SELECT 1 ;", "SELECT 1  \nFORMAT JSON"],
      // A query of only semicolons is sent unchanged.
      [";", "; \nFORMAT JSON"],
      ["SELECT ';'", "SELECT ';' \nFORMAT JSON"],
      ["SELECT ';' AS a;", "SELECT ';' AS a \nFORMAT JSON"],
      ["SELECT $$;$$", "SELECT $$;$$ \nFORMAT JSON"],
      ["SELECT `a;`", "SELECT `a;` \nFORMAT JSON"],
      // The newline before FORMAT ends a trailing line comment.
      ["SELECT 1 -- comment", "SELECT 1 -- comment \nFORMAT JSON"],
      ["SELECT 1 # comment", "SELECT 1 # comment \nFORMAT JSON"],
      ["SELECT 1 /* ; */", "SELECT 1 /* ; */ \nFORMAT JSON"],
      // A semicolon at the very end is stripped even inside a comment.
      ["SELECT 1 -- comment;", "SELECT 1 -- comment \nFORMAT JSON"],
    ])("%j", async (query, expected) => {
      expect(await sentByQuery(query)).toBe(expected);
    });

    it("uses the requested format", async () => {
      expect(await sentByQuery("SELECT 1;", "JSONEachRow")).toBe(
        "SELECT 1 \nFORMAT JSONEachRow",
      );
    });
  });

  describe.each([
    ["command()", sentByCommand],
    ["exec()", sentByExec],
  ])("%s strips trailing semicolons", (_, sentBy) => {
    it.each([
      ["SELECT 1", "SELECT 1"],
      ["  SELECT 1  \n", "SELECT 1"],
      ["SELECT 1;", "SELECT 1"],
      ["SELECT 1;;;", "SELECT 1"],
      ["SELECT 1 ;", "SELECT 1 "],
      [";", ";"],
      ["SELECT ';'", "SELECT ';'"],
      ["SELECT 1 -- comment", "SELECT 1 -- comment"],
      ["SELECT 1 -- comment;", "SELECT 1 -- comment"],
      // Left in place, but harmless here: nothing is appended after it.
      ["SELECT 1; -- comment", "SELECT 1; -- comment"],
    ])("%j", async (query, expected) => {
      expect(await sentBy(query)).toBe(expected);
    });
  });

  // Known bugs. These pin today's (wrong) output, so the PR that fixes each
  // bug changes the expected value here.
  describe("known bugs", () => {
    // https://github.com/ClickHouse/clickhouse-js/issues/973
    // The semicolon is kept, so the appended FORMAT becomes a second
    // statement and the server rejects the query.
    it.each([
      ["SELECT 1; -- comment", "SELECT 1; -- comment \nFORMAT JSON"],
      ["SELECT 1;\n-- comment", "SELECT 1;\n-- comment \nFORMAT JSON"],
      ["SELECT 1; /* comment */", "SELECT 1; /* comment */ \nFORMAT JSON"],
      ["SELECT 1; # comment", "SELECT 1; # comment \nFORMAT JSON"],
      [
        "SELECT ';' AS a; -- comment",
        "SELECT ';' AS a; -- comment \nFORMAT JSON",
      ],
    ])(
      "query() with a semicolon before a comment: %j",
      async (query, expected) => {
        expect(await sentByQuery(query)).toBe(expected);
      },
    );

    // https://github.com/ClickHouse/clickhouse-js/issues/970
    // FORMAT is appended after the SETTINGS clause, which older servers
    // reject.
    it.each([
      [
        "SELECT 1 SETTINGS max_threads = 1",
        "SELECT 1 SETTINGS max_threads = 1 \nFORMAT JSON",
      ],
      [
        "SELECT 1 SETTINGS max_threads = 1;",
        "SELECT 1 SETTINGS max_threads = 1 \nFORMAT JSON",
      ],
    ])(
      "query() with a trailing SETTINGS clause: %j",
      async (query, expected) => {
        expect(await sentByQuery(query)).toBe(expected);
      },
    );
  });
});
