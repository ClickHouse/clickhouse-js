import * as lexer from "@clickhouse/lexer";
import type { BaseClickHouseClientConfigOptions } from "@clickhouse/client-common";

/**
 * The two ways the client can rewrite SQL. Tests that send SQL through
 * query(), command() or exec() run once per mode with `describe.each`.
 */
export const sqlLexerModes: ReadonlyArray<
  [name: string, config: BaseClickHouseClientConfigOptions]
> = [
  ["built-in SQL handling", {}],
  ["official lexer", { sql_lexer: lexer }],
];

/**
 * Queries that are easy to get wrong when scanning SQL by hand. Every one is
 * a single valid statement (or one the server rejects on its own, such as an
 * unclosed quote), so the client must send it in a form the server reads the
 * same way.
 */
export const sqlCorpus: readonly string[] = [
  "SELECT 1",
  "  SELECT 1  \n",
  "SELECT 1;",
  "SELECT 1;;;",
  "SELECT 1 ; ;",
  // https://github.com/ClickHouse/clickhouse-js/issues/973
  "SELECT 1 -- note",
  "SELECT 1; -- note",
  "SELECT 1;\n-- note",
  "SELECT 1; # note",
  "SELECT 1; #!note",
  "SELECT 1; /* note */",
  "SELECT 1; // note",
  "SELECT 1;\r-- note",
  "SELECT 1; -- a\n-- b",
  "SELECT 1; -- a\n; -- b",
  "SELECT 1 -- note\n;",
  "SELECT 1 -- note;",
  "SELECT 1 -- a; b",
  // Semicolons and comment markers inside literals and identifiers
  "SELECT ';'",
  "SELECT ';' AS a; -- note",
  "SELECT 'it''s;'",
  "SELECT 'a\\';'",
  "SELECT '--';",
  "SELECT '/*';",
  "SELECT 1 AS `a;b`",
  'SELECT 1 AS "a;b"',
  "SELECT 'x' AS `a``;`; -- note",
  "SELECT 1 AS “a;”; -- note",
  // Comments
  "SELECT 1 /* ; */",
  "SELECT 1 /* a /* nested */ ; */;",
  "SELECT 1 /* a /* nested */ b */; -- note",
  // Heredocs, and `$` in identifiers
  "SELECT $$;$$",
  "SELECT $$;$$;",
  "SELECT $tag$-- text$tag$;",
  "SELECT $$a # b /* c$$; -- note",
  "SELECT $t$ -- ; $t$",
  "SELECT $$x$$ AS a, $$y$$ AS b; -- note",
  "SELECT 1 AS a$b; -- note",
  "SELECT 1 AS a$t$; -- $t$",
  // https://github.com/ClickHouse/clickhouse-js/issues/970
  "SELECT 1 SETTINGS max_threads = 1",
  "SELECT 1 SETTINGS max_threads = 1;",
  "SELECT 1 settings max_threads=1",
  "SELECT 1 SETTINGS max_threads = 1 -- note",
  "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1)",
  "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1) SETTINGS max_threads = 2",
  // Both rows are the same, as UNION ALL does not guarantee their order.
  "SELECT 1 SETTINGS max_threads = 1 UNION ALL SELECT 1",
  "SELECT 'SETTINGS max_threads = 1'",
  "SELECT 1 AS settings",
  // The server reports these itself
  "SELECT 'unterminated; -- note",
];

// Reasons for KNOWN_DIFFERENCES.
const SEMICOLON_BEFORE_COMMENT =
  "#973: a `;` followed by a comment is kept, as only `;` at the very end is removed";
const SPACED_SEMICOLONS =
  "only the `;` at the very end is removed, not ones separated by spaces";
const FORMAT_AFTER_SETTINGS =
  "#970: FORMAT is appended after a trailing SETTINGS clause";

/**
 * Where the built-in SQL handling is known to read a corpus query differently
 * from the official lexer, by the method that sends it. Each entry says why.
 *
 * The comparison tests fail both when a query differs and is not listed here,
 * and when a listed query no longer differs. So when the built-in handling is
 * fixed, they show exactly which entries to remove.
 */
export const KNOWN_DIFFERENCES: {
  /** query(): trailing semicolons removed, FORMAT added. */
  query: Readonly<Record<string, string>>;
  /** command() and exec(): trailing semicolons removed. */
  stripTrailingSemi: Readonly<Record<string, string>>;
} = {
  query: {
    "SELECT 1 ; ;": SPACED_SEMICOLONS,
    "SELECT 1; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1;\n-- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; # note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; #!note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; /* note */": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; // note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1;\r-- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; -- a\n-- b": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; -- a\n; -- b": SEMICOLON_BEFORE_COMMENT,
    "SELECT ';' AS a; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 'x' AS `a``;`; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 AS “a;”; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 /* a /* nested */ b */; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT $$a # b /* c$$; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT $$x$$ AS a, $$y$$ AS b; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 AS a$b; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 AS a$t$; -- $t$": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 SETTINGS max_threads = 1": FORMAT_AFTER_SETTINGS,
    "SELECT 1 SETTINGS max_threads = 1;": FORMAT_AFTER_SETTINGS,
    "SELECT 1 settings max_threads=1": FORMAT_AFTER_SETTINGS,
    "SELECT 1 SETTINGS max_threads = 1 -- note": FORMAT_AFTER_SETTINGS,
    "SELECT * FROM (SELECT 1 SETTINGS max_threads = 1) SETTINGS max_threads = 2":
      FORMAT_AFTER_SETTINGS,
  },
  // Harmless for command() and exec(), which append nothing after the `;`,
  // but still not what the server's lexer would read as the trailing `;`.
  stripTrailingSemi: {
    "SELECT 1 ; ;": SPACED_SEMICOLONS,
    "SELECT 1; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1;\n-- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; # note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; #!note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; /* note */": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; // note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1;\r-- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; -- a\n-- b": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1; -- a\n; -- b": SEMICOLON_BEFORE_COMMENT,
    "SELECT ';' AS a; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 'x' AS `a``;`; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 AS “a;”; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 /* a /* nested */ b */; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT $$a # b /* c$$; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT $$x$$ AS a, $$y$$ AS b; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 AS a$b; -- note": SEMICOLON_BEFORE_COMMENT,
    "SELECT 1 AS a$t$; -- $t$": SEMICOLON_BEFORE_COMMENT,
  },
};
