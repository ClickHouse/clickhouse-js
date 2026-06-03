import { quoteStringLiteral, quoteQualifiedIdentifier } from './escape.js'

/**
 * A bound query parameter destined for ClickHouse's `{name:Type}` placeholder
 * syntax.
 *
 * The dialect emits `{p0:T}` markers in the SQL, then hands the named values
 * to the driver (`@clickhouse/client.query({ query, query_params })`), which
 * forwards them as URL params (see `format_query_params.ts` in client-common).
 */
export interface BoundParam {
  /** ClickHouse type tag, e.g. `String`, `UInt32`, `DateTime64(3)`, `Array(Int8)`. */
  type: string
  /** Raw value forwarded to the driver — the driver does the final encoding. */
  value: unknown
}

/**
 * One node in a `sql\`...\`` template tree. Either a literal SQL chunk
 * (already escaped by the caller) or a placeholder that holds a value to be
 * bound at compile time.
 */
export type SQLChunk = string | SQLPlaceholder | SQL | Identifier

export class SQLPlaceholder {
  constructor(
    readonly value: unknown,
    readonly type?: string,
  ) {}
}

export class Identifier {
  constructor(readonly name: string) {}
}

/**
 * A composable SQL fragment built from string literals and placeholders.
 *
 * Use the {@link sql} tagged template to construct instances:
 *
 *   sql`SELECT * FROM ${ident('users')} WHERE id = ${42}`
 */
export class SQL {
  constructor(readonly chunks: ReadonlyArray<SQLChunk>) {}

  /** Append another fragment. */
  append(other: SQL): SQL {
    return new SQL([...this.chunks, ' ', ...other.chunks])
  }
}

/**
 * The compiled output of a {@link SQL} fragment: SQL text with positional
 * `{p0:T}` markers, plus the matching named parameter object.
 */
export interface CompiledSQL {
  sql: string
  params: Record<string, unknown>
}

/**
 * Tagged-template constructor that accepts both raw SQL chunks and inline
 * values. Values are turned into placeholders bound at compile time.
 */
export function sql(strings: TemplateStringsArray, ...values: unknown[]): SQL {
  const chunks: SQLChunk[] = []
  for (let i = 0; i < strings.length; i++) {
    chunks.push(strings[i] ?? '')
    if (i < values.length) {
      const v = values[i]
      if (v instanceof SQL || v instanceof Identifier) {
        chunks.push(v)
      } else if (v instanceof SQLPlaceholder) {
        chunks.push(v)
      } else {
        chunks.push(new SQLPlaceholder(v))
      }
    }
  }
  return new SQL(chunks)
}

/** Helper to embed an identifier into a `sql` template. */
export function ident(name: string): Identifier {
  return new Identifier(name)
}

/** Helper to embed a typed parameter into a `sql` template. */
export function param(value: unknown, type?: string): SQLPlaceholder {
  return new SQLPlaceholder(value, type)
}

/**
 * Infer the ClickHouse type tag of a JS value when the user didn't supply one.
 * This is intentionally conservative; users with non-trivial types (Decimals,
 * DateTime64 precisions, Arrays of specific element types, etc.) should use
 * {@link param} with an explicit type to avoid surprises.
 */
export function inferType(value: unknown): string {
  if (value === null || value === undefined) {
    // ClickHouse rejects untyped NULL params; require explicit type.
    throw new Error(
      '[drizzle-clickhouse] cannot infer type of null/undefined; use param(null, "Nullable(...)") instead',
    )
  }
  if (typeof value === 'string') return 'String'
  if (typeof value === 'boolean') return 'Bool'
  if (typeof value === 'bigint') return 'Int64'
  if (typeof value === 'number') {
    return Number.isInteger(value) ? 'Int64' : 'Float64'
  }
  if (value instanceof Date) return 'DateTime64(3)'
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new Error(
        '[drizzle-clickhouse] cannot infer element type of empty array; use param(value, "Array(...)")',
      )
    }
    return `Array(${inferType(value[0])})`
  }
  throw new Error(
    `[drizzle-clickhouse] cannot infer ClickHouse type of value: ${String(value)}`,
  )
}

/**
 * Compile a {@link SQL} fragment to text + named params, suitable for passing
 * to `client.query({ query, query_params })`.
 */
export function compile(node: SQL): CompiledSQL {
  const params: Record<string, unknown> = {}
  let counter = 0
  const text = renderChunks(node.chunks, params, () => `p${counter++}`)
  return { sql: text, params }
}

function renderChunks(
  chunks: ReadonlyArray<SQLChunk>,
  params: Record<string, unknown>,
  nextName: () => string,
): string {
  let out = ''
  for (const chunk of chunks) {
    if (typeof chunk === 'string') {
      out += chunk
    } else if (chunk instanceof Identifier) {
      out += quoteQualifiedIdentifier(chunk.name)
    } else if (chunk instanceof SQL) {
      out += renderChunks(chunk.chunks, params, nextName)
    } else {
      out += renderPlaceholder(chunk, params, nextName)
    }
  }
  return out
}

function renderPlaceholder(
  p: SQLPlaceholder,
  params: Record<string, unknown>,
  nextName: () => string,
): string {
  // Inline strategy: small literals (numbers, booleans, plain strings <=64 chars
  // with no control characters) are inlined for readability; everything else
  // becomes a typed placeholder so the driver handles encoding/escaping.
  const v = p.value
  if (p.type === undefined) {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v === 'boolean') return v ? 'true' : 'false'
    if (typeof v === 'bigint') return v.toString()
    if (typeof v === 'string' && v.length <= 64 && /^[\x20-\x7E]*$/.test(v)) {
      return quoteStringLiteral(v)
    }
  }
  const name = nextName()
  const type = p.type ?? inferType(v)
  params[name] = v
  return `{${name}:${type}}`
}
