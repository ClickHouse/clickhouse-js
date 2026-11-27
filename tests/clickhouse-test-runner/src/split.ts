// Split a multi-query script into statements, as clickhouse-client does (see
// ClientBase::executeMultiQuery and TestHint.cpp of ClickHouse/ClickHouse).
// Ported from the harness of clickhouse-connect (clickhouse_test_runner/split.py).

import {
  hasSignificantToken,
  heredocEnd,
  isWordChar,
  leadingKeyword,
  skipBlockComment,
  skipLineComment,
  skipQuoted,
  skipWhitespace,
  skipWhitespaceAndComments,
  startsLineComment,
  wordEnd,
} from "./lexer.js";
import { parseTestHint, type TestHint } from "./test-hint.js";

export interface Statement {
  /**
   * The text to send to the server: from the first non-whitespace character
   * (leading comments included) to the end of the statement, with its `;`.
   * clickhouse-client sends the `;`, and tests that read `system.query_log`
   * see it.
   */
  sql: string;
  /**
   * `sql` plus the same-line comment after the `;`. The test hints are read
   * from this text, and `echo` prints it.
   */
  full: string;
  hint: TestHint;
  /** Whether the statement is printed before its result (the echo hints). */
  echo: boolean;
}

/**
 * The length of the leading `-- Tags: ...` line and the `--` comment lines
 * right after it (`getTestTagsLength` of clickhouse-client). That header is not
 * part of a statement.
 */
export function testTagsLength(text: string): number {
  let pos = 0;
  let first = true;
  const n = text.length;
  for (;;) {
    const lineStart = pos;
    while (pos < n && (text.charAt(pos) === " " || text.charAt(pos) === "\t")) {
      pos++;
    }
    if (!text.startsWith("--", pos)) return lineStart;
    pos += 2;
    if (first) {
      while (
        pos < n &&
        (text.charAt(pos) === " " || text.charAt(pos) === "\t")
      ) {
        pos++;
      }
      if (!text.startsWith("Tags:", pos)) return 0;
      pos += "Tags:".length;
      first = false;
    }
    let eol = -1;
    for (let k = pos; k < n; k++) {
      const c = text.charAt(k);
      if (c === "\r" || c === "\n") {
        eol = k;
        break;
      }
    }
    if (eol < 0) return n;
    let eolLen = 1;
    const next = text.charAt(eol + 1);
    if (
      eol + 1 < n &&
      (next === "\r" || next === "\n") &&
      next !== text.charAt(eol)
    ) {
      eolLen = 2;
    }
    pos = eol + eolLen;
  }
}

/**
 * SQL words that can follow a column or an alias named `format`, as in
 * `INSERT INTO t SELECT format FROM s`. No format has such a name, so after
 * FORMAT they show an identifier, not the FORMAT clause.
 */
const CLAUSE_KEYWORDS = new Set(
  (
    "FROM WHERE PREWHERE AS AND OR NOT IN IS LIKE ILIKE BETWEEN GROUP ORDER LIMIT OFFSET " +
    "HAVING QUALIFY WINDOW UNION EXCEPT INTERSECT JOIN INNER LEFT RIGHT FULL CROSS ARRAY " +
    "ON USING SETTINGS INTO ASC DESC NULLS COLLATE WITH THEN ELSE END WHEN OVER GLOBAL " +
    "DIV MOD REGEXP FINAL SAMPLE FILL TIES BY"
  ).split(" "),
);

/** The words of `sql` outside quotes, heredocs, comments and parentheses. */
function topLevelWords(sql: string): string[] {
  const words: string[] = [];
  let depth = 0;
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql.charAt(i);
    if (c === "'" || c === '"' || c === "`") {
      i = skipQuoted(sql, i);
    } else if (startsLineComment(sql, i)) {
      i = skipLineComment(sql, i);
    } else if (sql.startsWith("/*", i)) {
      i = skipBlockComment(sql, i);
    } else if (c === "$") {
      const end = heredocEnd(sql, i);
      i = end > 0 ? end : i + 1;
    } else if (c === "(" || c === "[") {
      depth++;
      i++;
    } else if (c === ")" || c === "]") {
      depth--;
      i++;
    } else if (isWordChar(c)) {
      const j = wordEnd(sql, i);
      if (depth === 0) words.push(sql.slice(i, j));
      i = j;
    } else {
      i++;
    }
  }
  return words;
}

/**
 * Whether a FORMAT that follows `head` can be the FORMAT clause of an INSERT:
 * `head` has no top-level SELECT, or a top-level FROM follows its last
 * top-level SELECT.
 */
function formatAfterSelectFrom(head: string): boolean {
  let afterSelect = false;
  let sawFrom = false;
  for (const w of topLevelWords(head)) {
    const u = w.toUpperCase();
    if (u === "SELECT") {
      afterSelect = true;
      sawFrom = false;
    } else if (u === "FROM") {
      sawFrom = true;
    }
  }
  return !afterSelect || sawFrom;
}

/**
 * The offset of the inline data when the FORMAT keyword that ends at
 * `formatEnd` starts the inline data of an INSERT statement that begins at
 * `start`, else -1. The Values format is excluded: its data ends at `;`, as a
 * query does.
 */
function insertDataStart(
  text: string,
  start: number,
  formatEnd: number,
): number {
  if (leadingKeyword(text.slice(start, formatEnd)) !== "INSERT") return -1;
  let i = formatEnd;
  const n = text.length;
  if (i >= n || !" \t\n\r".includes(text.charAt(i))) return -1;
  while (i < n && " \t\n\r".includes(text.charAt(i))) i++;
  const j = wordEnd(text, i);
  const word = text.slice(i, j).toUpperCase();
  if (j === i || word === "VALUES" || CLAUSE_KEYWORDS.has(word)) return -1;
  // After a SELECT, the FORMAT clause comes at the end of the SELECT, so after
  // its top-level FROM: `INSERT INTO t SELECT * FROM input('x UInt8') FORMAT
  // TSV`. Before that FROM, `format` is in the select list.
  if (!formatAfterSelectFrom(text.slice(start, formatEnd - "FORMAT".length))) {
    return -1;
  }
  return j;
}

/** The offset of the `;` that ends the statement at `start`, or the end. */
function scanStatementEnd(text: string, start: number): number {
  let parens = 0;
  let i = start;
  const n = text.length;
  while (i < n) {
    const c = text.charAt(i);
    if (c === "'" || c === '"' || c === "`") {
      i = skipQuoted(text, i);
    } else if (
      (c === "-" && text.startsWith("--", i)) ||
      (c === "/" && text.startsWith("//", i)) ||
      (c === "#" && (text.startsWith("#!", i) || text.startsWith("# ", i)))
    ) {
      i = skipLineComment(text, i);
    } else if (c === "/" && text.startsWith("/*", i)) {
      i = skipBlockComment(text, i);
    } else if (c === "$") {
      const end = heredocEnd(text, i);
      i = end > 0 ? end : i + 1;
    } else if (c === "(" || c === "[") {
      parens++;
      i++;
    } else if (c === ")" || c === "]") {
      parens--;
      i++;
    } else if (c === ";" && parens <= 0) {
      return i;
    } else if (isWordChar(c)) {
      const j = wordEnd(text, i);
      if (
        parens <= 0 &&
        j - i === 6 &&
        text.slice(i, j).toUpperCase() === "FORMAT"
      ) {
        const dataStart = insertDataStart(text, start, j);
        if (dataStart >= 0) {
          // The inline data ends at an empty line.
          const k = text.indexOf("\n\n", dataStart);
          return k >= 0 ? k : n;
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return n;
}

function trimEndSpace(s: string): string {
  let e = s.length;
  while (e > 0 && " \t\r\n".includes(s.charAt(e - 1))) e--;
  return s.slice(0, e);
}

/**
 * Split a script into statements, as clickhouse-client does:
 * - The `-- Tags:` header is not part of a statement.
 * - A statement ends at a top-level `;`. A comment on the same line after the
 *   `;` belongs to that statement; the test hints are there.
 * - The inline data of `INSERT ... FORMAT <name>` (other than Values) ends at an
 *   empty line, not at `;`.
 * - Comment-only text after the last statement is not a statement.
 */
export function splitStatements(text: string): Statement[] {
  const out: Statement[] = [];
  let pos = testTagsLength(text);
  let echo = false;
  const n = text.length;
  for (;;) {
    pos = skipWhitespace(text, pos);
    if (pos >= n || !hasSignificantToken(text, pos)) return out;
    const begin = pos;
    const sqlEnd = scanStatementEnd(text, pos);
    // Consume the semicolons after the statement.
    pos = sqlEnd;
    while (pos < n && text.charAt(pos) === ";") {
      pos++;
      const nxt = skipWhitespaceAndComments(text, pos);
      if (nxt < n && text.charAt(nxt) === ";") pos = nxt;
    }
    // Add the same-line trailing comment when the next statement starts after
    // the end of this line.
    let newline = text.indexOf("\n", pos);
    if (newline < 0) newline = n;
    if (newline <= skipWhitespaceAndComments(text, pos)) pos = newline;
    const sql =
      sqlEnd < n && text.charAt(sqlEnd) === ";"
        ? text.slice(begin, sqlEnd + 1)
        : trimEndSpace(text.slice(begin, sqlEnd));
    // The last statement has no `;`: clickhouse-client echoes all the rest of
    // the text, with its trailing newlines.
    const full =
      sqlEnd === n ? text.slice(begin) : trimEndSpace(text.slice(begin, pos));
    const hint = parseTestHint(full);
    if (hint.echo !== null) echo = hint.echo;
    out.push({ sql, full, hint, echo });
    // A statement always moves the position forward; guard against a scan
    // that stops at its own start.
    if (pos <= begin) pos = begin + 1;
  }
}
