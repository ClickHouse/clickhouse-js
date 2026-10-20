import { describe, it, expect, beforeEach } from "vitest";
import * as lexer from "@clickhouse/lexer";
import type {
  BaseClickHouseClientConfigOptions,
  DataFormat,
} from "@clickhouse/client-common";
import { ClickHouseClient } from "../../src/client";
import { ClickHouseLogLevel } from "../../src/logger";

// Pins the exact SQL text that query(), command() and exec() hand to the
// connection, so that changes to how the client rewrites user SQL
// (trailing semicolons, the appended FORMAT clause) are always deliberate.

function buildCapturingClient(config: BaseClickHouseClientConfigOptions = {}) {
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
    ...config,
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
  config?: BaseClickHouseClientConfigOptions,
  format: DataFormat = "JSON",
): Promise<string> {
  const { client, sent } = buildCapturingClient(config);
  await client.query({ query, format });
  return sent[0];
}

async function sentByCommand(
  query: string,
  config?: BaseClickHouseClientConfigOptions,
): Promise<string> {
  const { client, sent } = buildCapturingClient(config);
  await client.command({ query });
  return sent[0];
}

async function sentByExec(
  query: string,
  config?: BaseClickHouseClientConfigOptions,
): Promise<string> {
  const { client, sent } = buildCapturingClient(config);
  await client.exec({ query });
  return sent[0];
}

describe("SQL rewriting", () => {
  describe("query() appends FORMAT", () => {
    // [query, sent without sql_lexer, sent with sql_lexer]
    it.each([
      ["SELECT 1", "SELECT 1 \nFORMAT JSON", "SELECT 1 \nFORMAT JSON"],
      ["  SELECT 1  \n", "SELECT 1 \nFORMAT JSON", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;", "SELECT 1 \nFORMAT JSON", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;;;", "SELECT 1 \nFORMAT JSON", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;\n", "SELECT 1 \nFORMAT JSON", "SELECT 1 \nFORMAT JSON"],
      // Whitespace before the semicolon is kept, hence the double space.
      ["SELECT 1 ;", "SELECT 1  \nFORMAT JSON", "SELECT 1  \nFORMAT JSON"],
      // A query of only semicolons is sent unchanged.
      [";", "; \nFORMAT JSON", "; \nFORMAT JSON"],
      ["SELECT ';'", "SELECT ';' \nFORMAT JSON", "SELECT ';' \nFORMAT JSON"],
      [
        "SELECT ';' AS a;",
        "SELECT ';' AS a \nFORMAT JSON",
        "SELECT ';' AS a \nFORMAT JSON",
      ],
      [
        "SELECT $$;$$",
        "SELECT $$;$$ \nFORMAT JSON",
        "SELECT $$;$$ \nFORMAT JSON",
      ],
      ["SELECT `a;`", "SELECT `a;` \nFORMAT JSON", "SELECT `a;` \nFORMAT JSON"],
      // The newline before FORMAT ends a trailing line comment.
      [
        "SELECT 1 -- comment",
        "SELECT 1 -- comment \nFORMAT JSON",
        "SELECT 1 -- comment \nFORMAT JSON",
      ],
      [
        "SELECT 1 # comment",
        "SELECT 1 # comment \nFORMAT JSON",
        "SELECT 1 # comment \nFORMAT JSON",
      ],
      [
        "SELECT 1 /* ; */",
        "SELECT 1 /* ; */ \nFORMAT JSON",
        "SELECT 1 /* ; */ \nFORMAT JSON",
      ],
      // Without the lexer, a semicolon at the very end is stripped even
      // inside a comment. With it, the comment is left as it is.
      [
        "SELECT 1 -- comment;",
        "SELECT 1 -- comment \nFORMAT JSON",
        "SELECT 1 -- comment; \nFORMAT JSON",
      ],
    ])("%j", async (query, withoutLexer, withLexer) => {
      expect(await sentByQuery(query)).toBe(withoutLexer);
      expect(await sentByQuery(query, { sql_lexer: lexer })).toBe(withLexer);
    });

    it("uses the requested format", async () => {
      expect(await sentByQuery("SELECT 1;", {}, "JSONEachRow")).toBe(
        "SELECT 1 \nFORMAT JSONEachRow",
      );
      expect(
        await sentByQuery("SELECT 1;", { sql_lexer: lexer }, "JSONEachRow"),
      ).toBe("SELECT 1 \nFORMAT JSONEachRow");
    });
  });

  describe.each([
    ["command()", sentByCommand],
    ["exec()", sentByExec],
  ])("%s strips trailing semicolons", (_, sentBy) => {
    // [query, sent without sql_lexer, sent with sql_lexer]
    it.each([
      ["SELECT 1", "SELECT 1", "SELECT 1"],
      ["  SELECT 1  \n", "SELECT 1", "SELECT 1"],
      ["SELECT 1;", "SELECT 1", "SELECT 1"],
      ["SELECT 1;;;", "SELECT 1", "SELECT 1"],
      ["SELECT 1 ;", "SELECT 1 ", "SELECT 1 "],
      [";", ";", ";"],
      ["SELECT ';'", "SELECT ';'", "SELECT ';'"],
      ["SELECT 1 -- comment", "SELECT 1 -- comment", "SELECT 1 -- comment"],
      // Without the lexer, a semicolon at the very end is stripped even
      // inside a comment. With it, the comment is left as it is.
      ["SELECT 1 -- comment;", "SELECT 1 -- comment", "SELECT 1 -- comment;"],
      // Without the lexer, the semicolon is left in place. That is harmless
      // here, as nothing is appended after it.
      ["SELECT 1; -- comment", "SELECT 1; -- comment", "SELECT 1 -- comment"],
    ])("%j", async (query, withoutLexer, withLexer) => {
      expect(await sentBy(query)).toBe(withoutLexer);
      expect(await sentBy(query, { sql_lexer: lexer })).toBe(withLexer);
    });
  });

  describe("when the sql_lexer fails to load", () => {
    const failingLexer = (reason: unknown) => ({
      ...lexer,
      loadLexer: () => Promise.reject(reason),
    });
    let warnings: unknown[];
    class RecordingLogger {
      trace() {}
      debug() {}
      info() {}
      warn(params: unknown) {
        warnings.push(params);
      }
      error() {}
    }
    beforeEach(() => {
      warnings = [];
    });

    it("warns once and uses the built-in handling", async () => {
      const { client, sent } = buildCapturingClient({
        sql_lexer: failingLexer(new Error("WebAssembly is blocked")),
        log: { LoggerClass: RecordingLogger },
      });
      await client.command({ query: "SELECT 1; -- comment" });
      await client.exec({ query: "SELECT 2;" });
      expect(sent).toEqual(["SELECT 1; -- comment", "SELECT 2"]);
      expect(warnings).toEqual([
        expect.objectContaining({
          module: "Client",
          message: expect.stringContaining("docs/howto/sql_lexer.md"),
          err: new Error("WebAssembly is blocked"),
        }),
      ]);
    });

    it("wraps a rejection that is not an Error", async () => {
      const { client } = buildCapturingClient({
        sql_lexer: failingLexer("blocked"),
        log: { LoggerClass: RecordingLogger },
      });
      await client.command({ query: "SELECT 1;" });
      expect(warnings).toEqual([
        expect.objectContaining({ err: new Error("blocked") }),
      ]);
    });

    it("does not warn when the log level is above WARN", async () => {
      const { client, sent } = buildCapturingClient({
        sql_lexer: failingLexer(new Error("WebAssembly is blocked")),
        log: { LoggerClass: RecordingLogger, level: ClickHouseLogLevel.ERROR },
      });
      await client.command({ query: "SELECT 1;" });
      expect(sent).toEqual(["SELECT 1"]);
      expect(warnings).toEqual([]);
    });
  });

  // Known bugs. These pin today's (wrong) output, so the PR that fixes each
  // bug changes the expected value here.
  describe("known bugs", () => {
    // https://github.com/ClickHouse/clickhouse-js/issues/973
    // Without the lexer, the semicolon is kept, so the appended FORMAT becomes
    // a second statement and the server rejects the query. The lexer fixes it.
    // [query, sent without sql_lexer, sent with sql_lexer]
    it.each([
      [
        "SELECT 1; -- comment",
        "SELECT 1; -- comment \nFORMAT JSON",
        "SELECT 1 -- comment \nFORMAT JSON",
      ],
      [
        "SELECT 1;\n-- comment",
        "SELECT 1;\n-- comment \nFORMAT JSON",
        "SELECT 1\n-- comment \nFORMAT JSON",
      ],
      [
        "SELECT 1; /* comment */",
        "SELECT 1; /* comment */ \nFORMAT JSON",
        "SELECT 1 /* comment */ \nFORMAT JSON",
      ],
      [
        "SELECT 1; # comment",
        "SELECT 1; # comment \nFORMAT JSON",
        "SELECT 1 # comment \nFORMAT JSON",
      ],
      [
        "SELECT ';' AS a; -- comment",
        "SELECT ';' AS a; -- comment \nFORMAT JSON",
        "SELECT ';' AS a -- comment \nFORMAT JSON",
      ],
    ])(
      "query() with a semicolon before a comment: %j",
      async (query, withoutLexer, withLexer) => {
        expect(await sentByQuery(query)).toBe(withoutLexer);
        expect(await sentByQuery(query, { sql_lexer: lexer })).toBe(withLexer);
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
