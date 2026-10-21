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
  const stripTrailingSemi = (query: string): string => {
    const trimmed = query.trim();
    const tokens = tokenize(trimmed);
    if (tokens === null) {
      return LegacySqlRewriter.stripTrailingSemi(query);
    }
    return removeTrailingSemicolons(trimmed, tokens);
  };
  return {
    stripTrailingSemi,
    // The newline ends a trailing line comment, so FORMAT is not commented out.
    withFormat(query, format) {
      return stripTrailingSemi(query) + " \nFORMAT " + format;
    },
  };
}

/**
 * Removes the semicolons after the last statement token, keeping any
 * whitespace and comments around them: `SELECT 1; -- note` becomes
 * `SELECT 1 -- note`. A query with no statement tokens is returned unchanged.
 */
function removeTrailingSemicolons(query: string, tokens: SqlToken[]): string {
  let tailStart = tokens.length;
  while (tailStart > 0 && isTrailingTrivia(tokens[tailStart - 1]!)) {
    tailStart--;
  }
  if (tailStart === 0) {
    return query;
  }
  // The tokens add up to the query exactly (see createSqlTokenizer).
  return tokens
    .filter((token, i) => i < tailStart || token.kind !== "semicolon")
    .map((token) => token.text)
    .join("");
}

function isTrailingTrivia(token: SqlToken): boolean {
  return (
    token.kind === "whitespace" ||
    token.kind === "comment" ||
    token.kind === "semicolon"
  );
}
