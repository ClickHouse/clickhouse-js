export function splitQueries(sql: string): string[] {
  const queries: string[] = []
  let current = ''

  let inSingleQuote = false
  let inDoubleQuote = false
  let inBacktick = false
  let escaping = false

  for (let i = 0; i < sql.length; i++) {
    const ch = sql.charAt(i)

    if (escaping) {
      current += ch
      escaping = false
      continue
    }

    if ((inSingleQuote || inDoubleQuote) && ch === '\\') {
      current += ch
      escaping = true
      continue
    }

    if (!inDoubleQuote && !inBacktick && ch === "'") {
      inSingleQuote = !inSingleQuote
      current += ch
      continue
    }
    if (!inSingleQuote && !inBacktick && ch === '"') {
      inDoubleQuote = !inDoubleQuote
      current += ch
      continue
    }
    if (!inSingleQuote && !inDoubleQuote && ch === '`') {
      inBacktick = !inBacktick
      current += ch
      continue
    }

    if (!inSingleQuote && !inDoubleQuote && !inBacktick && ch === ';') {
      const statement = current.trim()
      if (statement.length > 0) {
        queries.push(statement)
      }
      current = ''
      continue
    }

    current += ch
  }

  const trailing = current.trim()
  if (trailing.length > 0) {
    queries.push(trailing)
  }

  return queries
}
