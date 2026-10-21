import { describe, it, expect, beforeAll } from "vitest";
import * as lexer from "@clickhouse/lexer";
import { LegacySqlRewriter } from "../../src/sql/legacy";
import { loadLexerSqlRewriter } from "../../src/sql/lexer_rewriter";
import type { SqlRewriter } from "../../src/sql/rewriter";
import type { SqlTokenizer } from "../../src/sql/tokens";
import { createSqlTokenizer } from "../../src/sql/tokens";
import { KNOWN_DIFFERENCES, sqlCorpus } from "../utils/sql_corpus";

// Compares the built-in, hand-written SQL handling with the official
// ClickHouse lexer, without a server. Two rewrites of a query count as the
// same when the lexer reads them as the same tokens, ignoring whitespace and
// comments. See ../integration/sql_lexer.test.ts for the same corpus judged by
// a server.

let lexerRewriter: SqlRewriter;
let tokenize: SqlTokenizer;
beforeAll(async () => {
  lexerRewriter = await loadLexerSqlRewriter(lexer);
  tokenize = createSqlTokenizer(lexer);
});

/** The statement as the server reads it, or the raw text if it can't be tokenized. */
function statementTokens(sql: string): string[] {
  const tokens = tokenize(sql);
  if (tokens === null) {
    return [sql];
  }
  return tokens
    .filter((t) => t.kind !== "whitespace" && t.kind !== "comment")
    .map((t) => t.text);
}

describe.each([
  {
    method: "query()",
    rewrite: (r: SqlRewriter, sql: string) => r.withFormat(sql, "JSON"),
    known: KNOWN_DIFFERENCES.query,
  },
  {
    method: "command() and exec()",
    rewrite: (r: SqlRewriter, sql: string) => r.stripTrailingSemi(sql),
    known: KNOWN_DIFFERENCES.stripTrailingSemi,
  },
])(
  "$method: built-in SQL handling vs the official lexer",
  ({ rewrite, known }) => {
    it.each(sqlCorpus)("%j", (sql) => {
      const builtIn = rewrite(LegacySqlRewriter, sql);
      const official = rewrite(lexerRewriter, sql);
      const same =
        JSON.stringify(statementTokens(builtIn)) ===
        JSON.stringify(statementTokens(official));
      const reason = known[sql];
      if (reason === undefined) {
        expect(
          statementTokens(builtIn),
          `The built-in handling now differs from the official lexer.\n` +
            `  built-in sends: ${JSON.stringify(builtIn)}\n` +
            `  lexer sends:    ${JSON.stringify(official)}\n` +
            `Fix it, or list the query in KNOWN_DIFFERENCES with a reason.`,
        ).toEqual(statementTokens(official));
      } else {
        expect(
          same,
          `Listed in KNOWN_DIFFERENCES (${reason}), but the built-in handling ` +
            `now matches the official lexer. Remove the entry.`,
        ).toBe(false);
      }
    });

    it("lists only corpus queries as known differences", () => {
      expect(
        Object.keys(known).filter((sql) => !sqlCorpus.includes(sql)),
      ).toEqual([]);
    });
  },
);
