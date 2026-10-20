/**
 * The parts of the official ClickHouse SQL lexer (`@clickhouse/lexer`) the
 * client uses. Declared here so that the client does not depend on the
 * package or its types: `import * as lexer from '@clickhouse/lexer'` is
 * assignable to it as-is.
 */
export interface ClickHouseSqlLexer {
  loadLexer(): Promise<unknown>;
  tokenizeSync(query: string): ReadonlyArray<{ type: number; text: string }>;
  isError(type: number): boolean;
  TOKEN_NAMES: ReadonlyArray<string>;
}

export type SqlTokenKind =
  | "whitespace"
  | "comment"
  | "semicolon"
  | "bare_word"
  | "equals"
  | "comma"
  | "open_bracket"
  | "close_bracket"
  | "other";

export interface SqlToken {
  kind: SqlTokenKind;
  text: string;
}

/** Returns the tokens of a query, or `null` if the lexer cannot tokenize it. */
export type SqlTokenizer = (query: string) => SqlToken[] | null;

// Matched by name, not by number: the numbers change between lexer releases.
// Any token type not listed here is "other".
const KINDS_BY_NAME: Record<string, SqlTokenKind> = {
  Whitespace: "whitespace",
  Comment: "comment",
  Semicolon: "semicolon",
  BareWord: "bare_word",
  Equals: "equals",
  Comma: "comma",
  OpeningRoundBracket: "open_bracket",
  OpeningSquareBracket: "open_bracket",
  OpeningCurlyBrace: "open_bracket",
  ClosingRoundBracket: "close_bracket",
  ClosingSquareBracket: "close_bracket",
  ClosingCurlyBrace: "close_bracket",
};

/** The lexer must be loaded (`await lexer.loadLexer()`) before the tokenizer is used. */
export function createSqlTokenizer(lexer: ClickHouseSqlLexer): SqlTokenizer {
  const kinds = lexer.TOKEN_NAMES.map((name) => KINDS_BY_NAME[name] ?? "other");
  return (query) => {
    let lexed;
    try {
      lexed = lexer.tokenizeSync(query);
    } catch {
      return null;
    }
    const tokens: SqlToken[] = [];
    for (const { type, text } of lexed) {
      // The lexer stops at the first error, e.g. an unclosed quote.
      if (lexer.isError(type)) {
        return null;
      }
      tokens.push({ kind: kinds[type] ?? "other", text });
    }
    // Callers rebuild the query from the token texts, which is only valid if
    // they add up to it exactly. They don't if the query contains a lone
    // UTF-16 surrogate, which does not survive the round trip to UTF-8.
    if (tokens.map((t) => t.text).join("") !== query) {
      return null;
    }
    return tokens;
  };
}
