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

    if ((inSingleQuote || inDoubleQuote) && ch === "\\") {
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
