/// A small purpose-built tokenizer for ClickHouse data-type strings.
///
/// Type strings use a tiny slice of the SQL grammar — identifiers (bare,
/// backtick- or double-quoted), single-quoted string literals, numbers, and a
/// handful of punctuation tokens. Rather than vendor the full ClickHouse
/// `Lexer` (and its `UTF8Helpers` / `find_symbols` dependencies), this covers
/// exactly that slice, keeping the library free of any ClickHouse headers.
///
/// This is a faithful TypeScript port of the original C++ lexer.

/// A plain `const` object rather than a TS `enum`, so the source is erasable
/// and runs under Node's native type-stripping (which rejects `enum`). The
/// companion type below makes `TokenType` usable as both a value and a type.
export const TokenType = {
  End: "End", /// end of input
  Word: "Word", /// bare identifier / keyword, e.g. UInt8, Array, SIGNED
  QuotedIdent: "QuotedIdent", /// `backtick` or "double"-quoted identifier (decoded)
  Number: "Number", /// numeric literal (raw text, no sign)
  String: "String", /// single-quoted string literal (decoded)
  OpeningParen: "OpeningParen", /// (
  ClosingParen: "ClosingParen", /// )
  Comma: "Comma", /// ,
  Equals: "Equals", /// =
  Minus: "Minus", /// -
  Dot: "Dot", /// .
  Error: "Error", /// malformed token; `text` holds the message
} as const;
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export interface Token {
  type: TokenType;
  /// Word/Number: raw source text. QuotedIdent/String: decoded content.
  /// Error: the error message.
  text: string;
  /// Number only: true when the literal has a fractional part or exponent.
  is_float: boolean;
  /// Byte offset of the token start in the input (for diagnostics).
  begin: number;
}

function isSpace(c: string): boolean {
  return (
    c === " " ||
    c === "\t" ||
    c === "\n" ||
    c === "\r" ||
    c === "\f" ||
    c === "\v"
  );
}

function isDigit(c: string): boolean {
  return c >= "0" && c <= "9";
}

function isWordFirst(c: string): boolean {
  return (
    (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_" || c === "$"
  );
}

function isWordChar(c: string): boolean {
  return isWordFirst(c) || isDigit(c);
}

interface DecodeResult {
  ok: boolean;
  /// Decoded content (valid when ok is true).
  out: string;
  /// Error message (valid when ok is false).
  error: string;
  /// Position after the token (in/out replacement for `size_t & pos`).
  pos: number;
}

/// Decode the body of a quoted token (string literal or quoted identifier).
/// `quote` is the surrounding quote character. Handles C-style backslash
/// escapes and the SQL doubled-quote escape (e.g. '' inside '...'). Mirrors
/// the relevant behaviour of `tryReadQuotedStringWithSQLStyle`.
function decodeQuoted(input: string, pos: number, quote: string): DecodeResult {
  const n = input.length;
  let out = "";
  /// pos points at the opening quote.
  ++pos;
  while (pos < n) {
    const c = input[pos] as string;
    if (c === quote) {
      /// Doubled quote -> literal quote.
      if (pos + 1 < n && input[pos + 1] === quote) {
        out += quote;
        pos += 2;
        continue;
      }
      ++pos; /// consume the closing quote
      return { ok: true, out, error: "", pos };
    }
    if (c === "\\") {
      if (pos + 1 >= n) {
        return {
          ok: false,
          out,
          error: "unterminated escape in quoted literal",
          pos,
        };
      }
      const e = input[pos + 1] as string;
      switch (e) {
        case "b":
          out += "\b";
          break;
        case "f":
          out += "\f";
          break;
        case "n":
          out += "\n";
          break;
        case "r":
          out += "\r";
          break;
        case "t":
          out += "\t";
          break;
        case "0":
          out += "\0";
          break;
        case "a":
          out += "\x07";
          break;
        case "v":
          out += "\v";
          break;
        /// \\, \', \", \`, and any other char: keep the literal char.
        default:
          out += e;
          break;
      }
      pos += 2;
      continue;
    }
    out += c;
    ++pos;
  }
  return { ok: false, out, error: "unterminated quoted literal", pos };
}

/// Tokenize the whole input. The returned array always ends with an `End`
/// token. A malformed token yields a single trailing `Error` token.
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const n = input.length;

  const fail = (at: number, msg: string): void => {
    tokens.push({
      type: TokenType.Error,
      text: msg,
      is_float: false,
      begin: at,
    });
  };

  while (pos < n) {
    const c = input[pos] as string;

    if (isSpace(c)) {
      ++pos;
      continue;
    }

    const start = pos;

    switch (c) {
      case "(":
        tokens.push({
          type: TokenType.OpeningParen,
          text: "(",
          is_float: false,
          begin: start,
        });
        ++pos;
        continue;
      case ")":
        tokens.push({
          type: TokenType.ClosingParen,
          text: ")",
          is_float: false,
          begin: start,
        });
        ++pos;
        continue;
      case ",":
        tokens.push({
          type: TokenType.Comma,
          text: ",",
          is_float: false,
          begin: start,
        });
        ++pos;
        continue;
      case "=":
        tokens.push({
          type: TokenType.Equals,
          text: "=",
          is_float: false,
          begin: start,
        });
        ++pos;
        continue;
      case "-":
        tokens.push({
          type: TokenType.Minus,
          text: "-",
          is_float: false,
          begin: start,
        });
        ++pos;
        continue;
      default:
        break;
    }

    /// A dot may start a fractional number (.5) or be a standalone separator.
    if (c === "." && !(pos + 1 < n && isDigit(input[pos + 1] as string))) {
      tokens.push({
        type: TokenType.Dot,
        text: ".",
        is_float: false,
        begin: start,
      });
      ++pos;
      continue;
    }

    /// Quoted identifiers.
    if (c === "`" || c === '"') {
      const r = decodeQuoted(input, pos, c);
      pos = r.pos;
      if (!r.ok) {
        fail(start, r.error);
        break;
      }
      tokens.push({
        type: TokenType.QuotedIdent,
        text: r.out,
        is_float: false,
        begin: start,
      });
      continue;
    }

    /// String literal.
    if (c === "'") {
      const r = decodeQuoted(input, pos, c);
      pos = r.pos;
      if (!r.ok) {
        fail(start, r.error);
        break;
      }
      tokens.push({
        type: TokenType.String,
        text: r.out,
        is_float: false,
        begin: start,
      });
      continue;
    }

    /// Number.
    if (isDigit(c) || c === ".") {
      let is_float = false;
      /// integer part
      while (pos < n && isDigit(input[pos] as string)) ++pos;
      /// fraction
      if (pos < n && input[pos] === ".") {
        is_float = true;
        ++pos;
        while (pos < n && isDigit(input[pos] as string)) ++pos;
      }
      /// exponent — `e`/`E`, an optional sign, then AT LEAST ONE digit. A bare
      /// exponent like `1e` or `1e+` is malformed and must be rejected: without
      /// this guard it tokenizes as a Number whose raw text (`1e`) is emitted
      /// verbatim into a Float64 Literal's JSON `value`, yielding invalid JSON
      /// (`"value":1e`). Fail loudly here instead.
      if (pos < n && (input[pos] === "e" || input[pos] === "E")) {
        is_float = true;
        ++pos;
        if (pos < n && (input[pos] === "+" || input[pos] === "-")) ++pos;
        const exp_digits_start = pos;
        while (pos < n && isDigit(input[pos] as string)) ++pos;
        if (pos === exp_digits_start) {
          fail(start, "malformed number: exponent has no digits");
          break;
        }
      }
      tokens.push({
        type: TokenType.Number,
        text: input.substring(start, pos),
        is_float,
        begin: start,
      });
      continue;
    }

    /// Bare word / identifier / keyword.
    if (isWordFirst(c)) {
      while (pos < n && isWordChar(input[pos] as string)) ++pos;
      tokens.push({
        type: TokenType.Word,
        text: input.substring(start, pos),
        is_float: false,
        begin: start,
      });
      continue;
    }

    fail(start, "unexpected character '" + c + "'");
    break;
  }

  tokens.push({ type: TokenType.End, text: "", is_float: false, begin: pos });
  return tokens;
}
