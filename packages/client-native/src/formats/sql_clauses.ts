/**
 * Reads the settings of the `SETTINGS` clause of a statement, for example
 * `SELECT 1 SETTINGS output_format_json_quote_64bit_integers = 1 FORMAT JSON`.
 * The HTTP interface applies these settings to the output. The server does
 * not tell the client their values, so the client reads them from the SQL.
 *
 * The function uses the last `SETTINGS` clause that is not in parentheses.
 * It skips string literals, quoted identifiers and comments. It returns the
 * values as text, without quotes.
 */
export function settingsFromQuery(query: string): Record<string, string> {
  return readQueryClauses(query).settings;
}

/** Reads the top-level output clauses of a SQL statement. */
export function readQueryClauses(query: string): {
  settings: Record<string, string>;
  format: string | undefined;
} {
  const clauses = queryClausePositions(query);
  const parsed =
    clauses.settings < 0 ? undefined : readSettings(query, clauses.settings);
  const settings = parsed?.values ?? {};
  const name =
    clauses.format < 0
      ? undefined
      : readName(query, skipSpace(query, clauses.format));
  if (name === undefined) return { settings, format: undefined };
  let tail = skipSpace(query, name.end);
  if (
    parsed !== undefined &&
    tail === clauses.settings - "SETTINGS".length &&
    Object.keys(settings).length > 0
  ) {
    tail = parsed.end;
  }
  if (query[tail] === ";") tail = skipSpace(query, tail + 1);
  return { settings, format: tail === query.length ? name.text : undefined };
}

function readSettings(
  query: string,
  start: number,
): { values: Record<string, string>; end: number } {
  const result: Record<string, string> = {};
  let pos = start;
  for (;;) {
    pos = skipSpace(query, pos);
    const name = readName(query, pos);
    if (name === undefined) break;
    pos = skipSpace(query, name.end);
    if (query[pos] !== "=") break;
    pos = skipSpace(query, pos + 1);
    const value = readSettingValue(query, pos);
    if (value === undefined) break;
    result[name.text] = value.text;
    pos = skipSpace(query, value.end);
    if (query[pos] !== ",") break;
    pos++;
  }
  return { values: result, end: pos };
}

const WORD_CHAR = /[A-Za-z0-9_$]/;
const EXPECTS_EXPRESSION = new Set([
  "SELECT",
  "DISTINCT",
  "AS",
  "FROM",
  "JOIN",
  "WHERE",
  "PREWHERE",
  "HAVING",
  "BY",
  "ON",
  "AND",
  "OR",
  "NOT",
  "LIMIT",
  "OFFSET",
  "INTO",
  "WITH",
  "UNION",
]);

/** The positions after the top-level clause keywords, or -1. */
function queryClausePositions(query: string): {
  settings: number;
  format: number;
} {
  let depth = 0;
  let settings = -1;
  let format = -1;
  let afterExpression = false;
  let pos = 0;
  while (pos < query.length) {
    const c = query[pos] as string;
    const skipped = skipQuotedOrComment(query, pos);
    if (skipped !== pos) {
      if (depth === 0 && (c === "'" || c === '"' || c === "`" || c === "$")) {
        afterExpression = true;
      }
      pos = skipped;
    } else if (c === "(" || c === "[" || c === "{") {
      depth++;
      pos++;
    } else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) afterExpression = true;
      pos++;
    } else if (WORD_CHAR.test(c)) {
      let end = pos + 1;
      while (end < query.length && WORD_CHAR.test(query[end] as string)) end++;
      if (depth === 0) {
        const word = query.slice(pos, end).toUpperCase();
        if (word === "SETTINGS") settings = end;
        if (word === "FORMAT" && afterExpression) format = end;
        afterExpression = !EXPECTS_EXPRESSION.has(word);
      }
      pos = end;
    } else {
      if (depth === 0 && c === ";") break;
      if (depth === 0 && !/\s/.test(c)) afterExpression = c === "*";
      pos++;
    }
  }
  return { settings, format };
}

/** If a string literal, a quoted identifier or a comment starts at `pos`,
 *  returns the position after it. If not, returns `pos`. */
function skipQuotedOrComment(query: string, pos: number): number {
  const c = query[pos];
  const next = query[pos + 1];
  if (c === "'" || c === '"' || c === "`") {
    return skipQuoted(query, pos);
  }
  if (c === "$") {
    const delimiter = /^\$[A-Za-z0-9_]*\$/.exec(query.slice(pos))?.[0];
    if (delimiter !== undefined) {
      const end = query.indexOf(delimiter, pos + delimiter.length);
      return end < 0 ? query.length : end + delimiter.length;
    }
  }
  if (
    (c === "-" && next === "-") ||
    (c === "#" && (next === " " || next === "!"))
  ) {
    const end = query.indexOf("\n", pos);
    return end < 0 ? query.length : end + 1;
  }
  if (c === "/" && next === "*") {
    let depth = 1;
    let end = pos + 2;
    while (end < query.length && depth > 0) {
      if (query.startsWith("/*", end)) {
        depth++;
        end += 2;
      } else if (query.startsWith("*/", end)) {
        depth--;
        end += 2;
      } else {
        end++;
      }
    }
    return end;
  }
  return pos;
}

/** Returns the position after the quoted text that starts at `pos`. A quote
 *  in the text has a backslash before it, or it is written two times. */
function skipQuoted(query: string, pos: number): number {
  const quote = query[pos];
  let i = pos + 1;
  while (i < query.length) {
    const c = query[i];
    if (c === "\\") {
      i += 2;
    } else if (c === quote) {
      if (query[i + 1] !== quote) return i + 1;
      i += 2;
    } else {
      i++;
    }
  }
  return query.length;
}

function skipSpace(query: string, pos: number): number {
  let i = pos;
  for (;;) {
    while (i < query.length && /\s/.test(query[i] as string)) i++;
    const c = query[i];
    if (c !== "-" && c !== "#" && c !== "/") return i;
    const skipped = skipQuotedOrComment(query, i);
    if (skipped === i) return i;
    i = skipped;
  }
}

interface Token {
  text: string;
  end: number;
}

function readName(query: string, pos: number): Token | undefined {
  const c = query[pos];
  if (c === "`" || c === '"') {
    const end = skipQuoted(query, pos);
    return { text: unquote(query.slice(pos, end)), end };
  }
  let end = pos;
  while (end < query.length && /[A-Za-z0-9_.]/.test(query[end] as string)) {
    end++;
  }
  return end === pos ? undefined : { text: query.slice(pos, end), end };
}

function readSettingValue(query: string, pos: number): Token | undefined {
  if (query[pos] === "'") {
    const end = skipQuoted(query, pos);
    return { text: unquote(query.slice(pos, end)), end };
  }
  let end = pos;
  while (end < query.length && /[^\s,;()]/.test(query[end] as string)) end++;
  return end === pos ? undefined : { text: query.slice(pos, end), end };
}

const UNESCAPES: Record<string, string> = {
  n: "\n",
  t: "\t",
  r: "\r",
  "0": "\0",
  b: "\b",
  f: "\f",
};

/** Removes the quotes of a quoted text and decodes its escapes. */
function unquote(text: string): string {
  const quote = text[0] as string;
  const last =
    text.length > 1 && text.endsWith(quote) ? text.length - 1 : text.length;
  let out = "";
  for (let i = 1; i < last; i++) {
    const c = text[i] as string;
    if (c === "\\" && i + 1 < last) {
      const escaped = text[++i] as string;
      out += UNESCAPES[escaped] ?? escaped;
    } else if (c === quote && text[i + 1] === quote && i + 1 < last) {
      out += quote;
      i++;
    } else {
      out += c;
    }
  }
  return out;
}
