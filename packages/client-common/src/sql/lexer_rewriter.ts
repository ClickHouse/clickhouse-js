import { LegacySqlRewriter } from "./legacy";
import type { SqlRewriter } from "./rewriter";
import type { ClickHouseSqlLexer, SqlToken, SqlTokenizer } from "./tokens";
import { createSqlTokenizer } from "./tokens";

/** Loads the lexer and returns a rewriter that uses it. */
export async function loadLexerSqlRewriter(
  lexer: ClickHouseSqlLexer,
): Promise<SqlRewriter> {
  await lexer.loadLexer();
  return createLexerSqlRewriter(createSqlTokenizer(lexer));
}

/**
 * Token-based rewriting. Falls back to {@link LegacySqlRewriter} for queries
 * the lexer cannot tokenize, leaving them for the server to report.
 */
export function createLexerSqlRewriter(tokenize: SqlTokenizer): SqlRewriter {
  return {
    stripTrailingSemi(query) {
      const tokens = tokenize(query.trim());
      if (tokens === null) {
        return LegacySqlRewriter.stripTrailingSemi(query);
      }
      return join(removeTrailingSemicolons(tokens));
    },
    withFormat(query, format) {
      const tokens = tokenize(query.trim());
      if (tokens === null) {
        return LegacySqlRewriter.withFormat(query, format);
      }
      const statement = removeTrailingSemicolons(tokens);
      // https://github.com/ClickHouse/clickhouse-js/issues/970
      // FORMAT goes before a trailing SETTINGS clause, as some servers
      // require SETTINGS to come last.
      const settings = trailingSettingsClauseIndex(statement);
      if (settings !== -1) {
        const before = statement.slice(0, settings);
        const separator = before.at(-1)?.kind === "whitespace" ? "" : " ";
        return (
          join(before) +
          separator +
          "FORMAT " +
          format +
          " " +
          join(statement.slice(settings))
        );
      }
      // The newline ends a trailing line comment, so FORMAT is not commented out.
      return join(statement) + " \nFORMAT " + format;
    },
  };
}

/**
 * Removes the semicolons after the last statement token, keeping any
 * whitespace and comments around them: `SELECT 1; -- note` becomes
 * `SELECT 1 -- note`. A query with no statement tokens is returned unchanged.
 */
function removeTrailingSemicolons(tokens: SqlToken[]): SqlToken[] {
  let tailStart = tokens.length;
  while (tailStart > 0 && !isSignificant(tokens[tailStart - 1]!)) {
    tailStart--;
  }
  if (tailStart === 0) {
    return tokens;
  }
  return tokens.filter(
    (token, i) => i < tailStart || token.kind !== "semicolon",
  );
}

/**
 * The index of the `SETTINGS` keyword that starts a clause running to the end
 * of the statement, or -1 if there is none. The clause must be outside any
 * brackets and be exactly a `name = value, ...` list, so that `SETTINGS` in a
 * subquery, a column named `settings`, or a SETTINGS clause followed by more
 * of the query (`... SETTINGS a = 1 UNION ALL SELECT 2`) are left alone.
 */
function trailingSettingsClauseIndex(tokens: SqlToken[]): number {
  // The significant tokens at bracket depth 0, with their indices.
  const topLevel: Array<{ token: SqlToken; index: number }> = [];
  let depth = 0;
  tokens.forEach((token, index) => {
    if (token.kind === "close_bracket") {
      depth--;
    }
    if (depth === 0 && isSignificant(token)) {
      topLevel.push({ token, index });
    }
    if (token.kind === "open_bracket") {
      depth++;
    }
  });
  if (depth !== 0) {
    return -1;
  }
  for (let i = topLevel.length - 1; i >= 0; i--) {
    const { token, index } = topLevel[i]!;
    if (token.kind === "bare_word" && token.text.toUpperCase() === "SETTINGS") {
      return isSettingsList(topLevel.slice(i + 1).map((t) => t.token))
        ? index
        : -1;
    }
  }
  return -1;
}

/**
 * Whether the tokens are a `name = value, name = value` list. A value can be
 * several tokens, such as `-1` or `[1, 2]`; brackets are skipped by the caller.
 */
function isSettingsList(tokens: SqlToken[]): boolean {
  let expectName = true;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    if (expectName) {
      if (token.kind !== "bare_word" || tokens[i + 1]?.kind !== "equals") {
        return false;
      }
      i++; // the `=`
      expectName = false;
      // A value must follow.
      if (i + 1 >= tokens.length || tokens[i + 1]!.kind === "comma") {
        return false;
      }
    } else if (token.kind === "comma") {
      expectName = true;
    } else if (token.kind === "bare_word" && tokens[i - 1]?.kind !== "equals") {
      // A keyword after a complete value, e.g. UNION.
      return false;
    }
  }
  return !expectName;
}

function isSignificant(token: SqlToken): boolean {
  return (
    token.kind !== "whitespace" &&
    token.kind !== "comment" &&
    token.kind !== "semicolon"
  );
}

// The tokens add up to the query exactly (see createSqlTokenizer).
function join(tokens: SqlToken[]): string {
  return tokens.map((token) => token.text).join("");
}
