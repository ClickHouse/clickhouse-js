import { describe, it, expect, beforeAll } from "vitest";
import * as lexer from "@clickhouse/lexer";
import type { SqlRewriter } from "../../src/sql/rewriter";
import type { ClickHouseSqlLexer } from "../../src/sql/tokens";
import { createSqlTokenizer } from "../../src/sql/tokens";
import { loadLexerSqlRewriter } from "../../src/sql/lexer_rewriter";

describe("lexer SQL rewriter", () => {
  let rewriter: SqlRewriter;
  beforeAll(async () => {
    rewriter = await loadLexerSqlRewriter(lexer);
  });

  describe("stripTrailingSemi", () => {
    it.each([
      ["SELECT 1", "SELECT 1"],
      ["  SELECT 1;  \n", "SELECT 1"],
      ["SELECT 1;;;", "SELECT 1"],
      ["SELECT 1 ;", "SELECT 1 "],
      ["SELECT 1 ; ;", "SELECT 1  "],
      // A query of only semicolons is sent unchanged, as before.
      [";", ";"],
      ["SELECT ';'", "SELECT ';'"],
      ["SELECT ';' AS a;", "SELECT ';' AS a"],
      ["SELECT `a;`;", "SELECT `a;`"],
      ['SELECT "a;";', 'SELECT "a;"'],
      ["SELECT $$;$$;", "SELECT $$;$$"],
      ["SELECT $tag$-- text;$tag$;", "SELECT $tag$-- text;$tag$"],
      // https://github.com/ClickHouse/clickhouse-js/issues/973
      ["SELECT 1; -- comment", "SELECT 1 -- comment"],
      ["SELECT 1;\n-- comment", "SELECT 1\n-- comment"],
      ["SELECT 1; /* comment */", "SELECT 1 /* comment */"],
      ["SELECT 1; # comment", "SELECT 1 # comment"],
      ["SELECT 1; -- a\n; -- b", "SELECT 1 -- a\n -- b"],
      ["SELECT $$;$$; -- comment", "SELECT $$;$$ -- comment"],
      // A semicolon inside a comment is part of the comment.
      ["SELECT 1 -- comment;", "SELECT 1 -- comment;"],
      ["SELECT 1 /* a /* nested */ ; */;", "SELECT 1 /* a /* nested */ ; */"],
      // Only the semicolons after the last statement are removed.
      ["SELECT 1; SELECT 2;", "SELECT 1; SELECT 2"],
    ])("%j", (query, expected) => {
      expect(rewriter.stripTrailingSemi(query)).toBe(expected);
    });

    describe("falls back to the string-based handling", () => {
      it("when the lexer reports an error", () => {
        expect(rewriter.stripTrailingSemi("SELECT 'unclosed;")).toBe(
          "SELECT 'unclosed",
        );
      });

      it("when the query contains a lone surrogate", () => {
        expect(rewriter.stripTrailingSemi("SELECT '\uD800'; -- c")).toBe(
          "SELECT '\uD800'; -- c",
        );
      });

      it("when the lexer throws", async () => {
        const throwing: ClickHouseSqlLexer = {
          ...lexer,
          tokenizeSync: () => {
            throw new Error("boom");
          },
        };
        const fallback = await loadLexerSqlRewriter(throwing);
        expect(fallback.stripTrailingSemi("SELECT 1; -- c")).toBe(
          "SELECT 1; -- c",
        );
        expect(fallback.stripTrailingSemi("SELECT 1;")).toBe("SELECT 1");
      });
    });
  });

  describe("withFormat", () => {
    it.each([
      ["SELECT 1", "SELECT 1 \nFORMAT JSON"],
      ["SELECT 1;", "SELECT 1 \nFORMAT JSON"],
      // https://github.com/ClickHouse/clickhouse-js/issues/973
      ["SELECT 1; -- comment", "SELECT 1 -- comment \nFORMAT JSON"],
      ["SELECT 1 -- comment;", "SELECT 1 -- comment; \nFORMAT JSON"],
    ])("%j", (query, expected) => {
      expect(rewriter.withFormat(query, "JSON")).toBe(expected);
    });

    it("falls back to the string-based handling", () => {
      expect(rewriter.withFormat("SELECT 'unclosed;", "JSON")).toBe(
        "SELECT 'unclosed \nFORMAT JSON",
      );
    });
  });
});

describe("createSqlTokenizer", () => {
  const fakeLexer = (
    tokens: Array<{ type: number; text: string }>,
  ): ClickHouseSqlLexer => ({
    loadLexer: async () => {},
    tokenizeSync: () => tokens,
    isError: (type) => type === 3,
    TOKEN_NAMES: ["Whitespace", "Semicolon", "SomethingNew", "Error"],
  });

  it("maps token types by name, and unknown names to other", () => {
    const tokenize = createSqlTokenizer(
      fakeLexer([
        { type: 2, text: "x" },
        { type: 0, text: " " },
        { type: 1, text: ";" },
        { type: 99, text: "y" },
      ]),
    );
    expect(tokenize("x ;y")).toEqual([
      { kind: "other", text: "x" },
      { kind: "whitespace", text: " " },
      { kind: "semicolon", text: ";" },
      { kind: "other", text: "y" },
    ]);
  });

  it("returns null on an error token", () => {
    const tokenize = createSqlTokenizer(
      fakeLexer([
        { type: 0, text: " " },
        { type: 3, text: "" },
      ]),
    );
    expect(tokenize(" '")).toBeNull();
  });

  it("returns null when the tokens do not add up to the query", () => {
    const tokenize = createSqlTokenizer(fakeLexer([{ type: 0, text: " " }]));
    expect(tokenize("  ")).toBeNull();
  });
});
