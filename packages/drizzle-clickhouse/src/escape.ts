/**
 * Quote a ClickHouse identifier (database, table, column, alias) with backticks
 * and escape embedded backticks/backslashes as ClickHouse expects.
 *
 * See https://clickhouse.com/docs/en/sql-reference/syntax#identifiers
 */
export function quoteIdentifier(name: string): string {
  if (name.length === 0) {
    throw new Error('[drizzle-clickhouse] identifier must be non-empty')
  }
  return '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'
}

/**
 * Quote a possibly-qualified identifier of the form `db.table` or `table`,
 * preserving dots as separators. Each segment is escaped independently.
 */
export function quoteQualifiedIdentifier(qualified: string): string {
  return qualified.split('.').map(quoteIdentifier).join('.')
}

/**
 * Escape a single ClickHouse string literal value (without the surrounding quotes).
 * Mirrors {@link packages/client-common/src/data_formatter/format_query_params.ts}'s
 * escape table: `\n`, `\t`, `\r`, `\\`, `\'`.
 */
export function escapeStringLiteralBody(value: string): string {
  let out = ''
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i)
    switch (c) {
      case 0x5c: // '\'
        out += '\\\\'
        break
      case 0x27: // "'"
        out += "\\'"
        break
      case 0x0a:
        out += '\\n'
        break
      case 0x0d:
        out += '\\r'
        break
      case 0x09:
        out += '\\t'
        break
      default:
        out += value[i]
    }
  }
  return out
}

/** Wrap with single quotes after escaping. */
export function quoteStringLiteral(value: string): string {
  return "'" + escapeStringLiteralBody(value) + "'"
}
