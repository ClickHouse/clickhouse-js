/** `[A-Za-z0-9_]`, matching the server lexer's `isWordCharASCII`. */
function isWordChar(code: number): boolean {
  return (
    (code >= 0x61 && code <= 0x7a) || // a-z
    (code >= 0x41 && code <= 0x5a) || // A-Z
    (code >= 0x30 && code <= 0x39) || // 0-9
    code === 0x5f // _
  );
}

/**
 * Returns the exclusive end offset of the dollar-quoted heredoc that starts at
 * `start` (which points at a `$`), or `-1` when that `$` does not open one.
 *
 * Mirrors the server lexer: the opening delimiter is `$`, an optional tag of
 * word characters, and `$` again (so `$$` and `$tag$`); the heredoc runs to the
 * next occurrence of the same delimiter. An unterminated delimiter is not a
 * heredoc, and its `$` is then an ordinary character.
 */
function findHeredocEnd(sql: string, start: number): number {
  const tagEnd = sql.indexOf("$", start + 1);
  if (tagEnd === -1) return -1;
  for (let i = start + 1; i < tagEnd; i++) {
    if (!isWordChar(sql.charCodeAt(i))) return -1;
  }
  const delimiter = sql.slice(start, tagEnd + 1);
  const end = sql.indexOf(delimiter, tagEnd + 1);
  if (end === -1) return -1;
  return end + delimiter.length;
}

export function splitQueries(sql: string): string[] {
  const queries: string[] = [];
  let current = "";

  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inBacktick = false;
  let escaping = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql.charAt(i);

    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }

    if ((inSingleQuote || inDoubleQuote || inBacktick) && ch === "\\") {
      current += ch;
      escaping = true;
      continue;
    }

    // Skip SQL comments when not inside a quoted string so that apostrophes
    // or semicolons embedded in comments do not affect statement splitting.
    if (!inSingleQuote && !inDoubleQuote && !inBacktick) {
      // Line comment: -- ... until end of line
      if (ch === "-" && sql.charAt(i + 1) === "-") {
        const newlineIdx = sql.indexOf("\n", i + 2);
        const end = newlineIdx === -1 ? sql.length : newlineIdx;
        current += sql.slice(i, end);
        i = end - 1;
        continue;
      }
      // Block comment: /* ... */
      if (ch === "/" && sql.charAt(i + 1) === "*") {
        const closeIdx = sql.indexOf("*/", i + 2);
        const end = closeIdx === -1 ? sql.length : closeIdx + 2;
        current += sql.slice(i, end);
        i = end - 1;
        continue;
      }
      // Dollar-quoted heredoc: $$ ... $$ or $tag$ ... $tag$. The server lexer
      // reads the whole region as a single token, so quotes, comment markers
      // and semicolons inside it must not affect the split.
      if (ch === "$") {
        const heredocEnd = findHeredocEnd(sql, i);
        if (heredocEnd !== -1) {
          current += sql.slice(i, heredocEnd);
          i = heredocEnd - 1;
          continue;
        }
      }
    }

    if (!inDoubleQuote && !inBacktick && ch === "'") {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (!inSingleQuote && !inBacktick && ch === '"') {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }
    if (!inSingleQuote && !inDoubleQuote && ch === "`") {
      inBacktick = !inBacktick;
      current += ch;
      continue;
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick && ch === ";") {
      const statement = current.trim();
      if (statement.length > 0) {
        queries.push(statement);
      }
      current = "";
      continue;
    }

    current += ch;
  }

  const trailing = current.trim();
  if (trailing.length > 0) {
    queries.push(trailing);
  }

  return queries;
}
