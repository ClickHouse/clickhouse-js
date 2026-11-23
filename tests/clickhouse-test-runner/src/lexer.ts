// Lexical helpers for the statement splitter, the test hints and the session
// state. They follow the lexer of the ClickHouse server: quoted strings and
// identifiers with backslash escapes and doubled quotes, `--`, `//`, `#!` and
// `# ` line comments, nested block comments, `$tag$` heredocs, and the Unicode
// whitespace that the server lexer skips. Ported from the harness of
// clickhouse-connect (tests/clickhouse-test-runner/clickhouse_test_runner/lexer.py).

/**
 * ASCII whitespace, and the Unicode whitespace that the ClickHouse lexer also
 * skips (text copied from word processors).
 */
const SPACE = new Set<string>([
  " ",
  "\t",
  "\n",
  "\r",
  "\f",
  "\v",
  "\u0085",
  " ",
  "᠎",
  ...Array.from({ length: 0x200e - 0x2000 }, (_, k) =>
    String.fromCharCode(0x2000 + k),
  ),
  " ",
  " ",
  " ",
  " ",
  "⁠",
  "　",
  "﻿",
]);

export function isSpace(c: string): boolean {
  return SPACE.has(c);
}

/** `[A-Za-z0-9_]`, as `isWordCharASCII` of the server lexer. */
export function isWordChar(c: string): boolean {
  return (
    c === "_" ||
    (c >= "a" && c <= "z") ||
    (c >= "A" && c <= "Z") ||
    (c >= "0" && c <= "9")
  );
}

/** The end offset of the word that starts at `i` (`i` when there is none). */
export function wordEnd(text: string, i: number): number {
  let j = i;
  while (j < text.length && isWordChar(text.charAt(j))) j++;
  return j;
}

/** The offset after the quoted string, identifier or name that starts at `i`. */
export function skipQuoted(text: string, i: number): number {
  const q = text.charAt(i);
  let j = i + 1;
  const n = text.length;
  while (j < n) {
    const c = text.charAt(j);
    if (c === "\\") {
      j += 2;
      continue;
    }
    if (c === q) {
      // A doubled quote is an escaped quote.
      if (j + 1 < n && text.charAt(j + 1) === q) {
        j += 2;
        continue;
      }
      return j + 1;
    }
    j++;
  }
  return n;
}

export function startsLineComment(text: string, i: number): boolean {
  return (
    text.startsWith("--", i) ||
    text.startsWith("//", i) ||
    text.startsWith("#!", i) ||
    text.startsWith("# ", i)
  );
}

/** The offset of the newline that ends the line comment at `i`, or the end. */
export function skipLineComment(text: string, i: number): number {
  const nl = text.indexOf("\n", i);
  return nl < 0 ? text.length : nl;
}

/** The offset after the block comment at `i`. Block comments nest in ClickHouse. */
export function skipBlockComment(text: string, i: number): number {
  let depth = 0;
  let j = i;
  const n = text.length;
  while (j < n - 1) {
    if (text.charAt(j) === "/" && text.charAt(j + 1) === "*") {
      depth++;
      j += 2;
    } else if (text.charAt(j) === "*" && text.charAt(j + 1) === "/") {
      depth--;
      j += 2;
      if (depth === 0) return j;
    } else {
      j++;
    }
  }
  return n;
}

/**
 * The end offset of the `$tag$ ... $tag$` heredoc that starts at `i`, or 0 when
 * the `$` does not open one (an unterminated delimiter is not a heredoc).
 */
export function heredocEnd(text: string, i: number): number {
  const tagEnd = text.indexOf("$", i + 1);
  if (tagEnd < 0) return 0;
  for (let k = i + 1; k < tagEnd; k++) {
    if (!isWordChar(text.charAt(k))) return 0;
  }
  const delim = text.slice(i, tagEnd + 1);
  const end = text.indexOf(delim, tagEnd + 1);
  if (end < 0) return 0;
  return end + delim.length;
}

export function skipWhitespace(text: string, i: number): number {
  while (i < text.length && isSpace(text.charAt(i))) i++;
  return i;
}

export function skipWhitespaceAndComments(text: string, i: number): number {
  const n = text.length;
  while (i < n) {
    if (isSpace(text.charAt(i))) {
      i++;
    } else if (startsLineComment(text, i)) {
      i = skipLineComment(text, i);
    } else if (text.startsWith("/*", i)) {
      i = skipBlockComment(text, i);
    } else {
      return i;
    }
  }
  return i;
}

export function hasSignificantToken(text: string, i = 0): boolean {
  return skipWhitespaceAndComments(text, i) < text.length;
}

/**
 * `text` with each comment replaced by a space. Quoted strings, quoted
 * identifiers and heredocs do not change.
 */
export function stripComments(text: string): string {
  const parts: string[] = [];
  let start = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charAt(i);
    if (c === "'" || c === '"' || c === "`") {
      i = skipQuoted(text, i);
    } else if (c === "$") {
      const end = heredocEnd(text, i);
      i = end > 0 ? end : i + 1;
    } else if (startsLineComment(text, i) || text.startsWith("/*", i)) {
      parts.push(text.slice(start, i), " ");
      i = text.startsWith("/*", i)
        ? skipBlockComment(text, i)
        : skipLineComment(text, i);
      start = i;
    } else {
      i++;
    }
  }
  parts.push(text.slice(start));
  return parts.join("");
}

/**
 * The first word of a statement in upper case, after comments, whitespace and
 * opening parentheses (`(SELECT ...)`).
 */
export function leadingKeyword(sql: string): string {
  let i = skipWhitespaceAndComments(sql, 0);
  while (i < sql.length && (sql.charAt(i) === "(" || isSpace(sql.charAt(i)))) {
    i = skipWhitespaceAndComments(sql, i + 1);
  }
  return sql.slice(i, wordEnd(sql, i)).toUpperCase();
}
