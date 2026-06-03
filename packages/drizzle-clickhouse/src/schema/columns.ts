import { quoteStringLiteral } from '../escape.js'
import type { SQL } from '../sql.js'

/**
 * Erased column shape used by the dialect. The TS-level generic type lives
 * separately on {@link Column} so that schema users still get inferred
 * SELECT/INSERT row types.
 */
export interface ColumnRuntime {
  /** Final ClickHouse DDL type string, e.g. `Nullable(LowCardinality(String))`. */
  readonly ddlType: string
  /** ClickHouse name (after `.name(...)` rename, otherwise the JS key). */
  readonly clickhouseName: string | undefined
  readonly _default?: unknown | SQL
  readonly _defaultKind?:
    | 'value'
    | 'expression'
    | 'materialized'
    | 'alias'
    | 'ephemeral'
  readonly _codec?: string
  readonly _ttl?: SQL
  readonly _comment?: string
  readonly _nullable: boolean
  readonly _lowCardinality: boolean
}

/**
 * TypeScript-typed column descriptor. `TData` is the row-shape type that
 * appears in `$inferSelect`; `TInsert` is the insert-shape type. They are
 * separate to model fields that are optional on insert (e.g. defaults).
 */
export class Column<TData = unknown, TInsert = TData> implements ColumnRuntime {
  declare readonly _: { data: TData; insert: TInsert }

  ddlType: string
  clickhouseName: string | undefined
  _default?: unknown
  _defaultKind?: ColumnRuntime['_defaultKind']
  _codec?: string
  _ttl?: SQL
  _comment?: string
  _nullable = false
  _lowCardinality = false
  _hasDefault = false

  constructor(ddlType: string) {
    this.ddlType = ddlType
  }

  /** Override the on-disk column name (defaults to the JS property key). */
  name(n: string): this {
    this.clickhouseName = n
    return this
  }

  /** `Nullable(T)` wrapper. */
  nullable(): Column<TData | null, TInsert | null> {
    this._nullable = true
    this.ddlType = `Nullable(${this.ddlType})`
    return this as unknown as Column<TData | null, TInsert | null>
  }

  /** `LowCardinality(T)` wrapper — only valid on Strings / FixedString / numeric scalars. */
  lowCardinality(): this {
    if (this._lowCardinality) return this
    this._lowCardinality = true
    // Apply outside any Nullable so the DDL reads `LowCardinality(Nullable(T))`.
    this.ddlType = `LowCardinality(${this.ddlType})`
    return this
  }

  /** Eager DEFAULT value or SQL expression. */
  default(value: TInsert | SQL): Column<TData, TInsert | undefined> {
    this._default = value
    this._defaultKind = isSQL(value) ? 'expression' : 'value'
    this._hasDefault = true
    return this as unknown as Column<TData, TInsert | undefined>
  }

  /** MATERIALIZED expression. The column is not insertable. */
  materialized(expr: SQL): Column<TData, never> {
    this._default = expr
    this._defaultKind = 'materialized'
    this._hasDefault = true
    return this as unknown as Column<TData, never>
  }

  /** ALIAS expression — not stored, computed on read. */
  alias(expr: SQL): Column<TData, never> {
    this._default = expr
    this._defaultKind = 'alias'
    this._hasDefault = true
    return this as unknown as Column<TData, never>
  }

  /** EPHEMERAL with optional default — not stored, only valid in INSERTs. */
  ephemeral(value?: TInsert | SQL): this {
    this._default = value
    this._defaultKind = 'ephemeral'
    this._hasDefault = true
    return this
  }

  codec(codec: string): this {
    this._codec = codec
    return this
  }

  ttl(expr: SQL): this {
    this._ttl = expr
    return this
  }

  comment(text: string): this {
    this._comment = text
    return this
  }
}

function isSQL(v: unknown): v is SQL {
  return typeof v === 'object' && v !== null && 'chunks' in v
}

// ── Scalar constructors ────────────────────────────────────────────────────

export const string = () => new Column<string>('String')
export const fixedString = (n: number) => {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(
      '[drizzle-clickhouse] fixedString length must be a positive integer',
    )
  }
  return new Column<string>(`FixedString(${n})`)
}
export const uuid = () => new Column<string>('UUID')
export const ipv4 = () => new Column<string>('IPv4')
export const ipv6 = () => new Column<string>('IPv6')

export const bool = () => new Column<boolean>('Bool')

export const int8 = () => new Column<number>('Int8')
export const int16 = () => new Column<number>('Int16')
export const int32 = () => new Column<number>('Int32')
export const int64 = () => new Column<string>('Int64') // string by default to avoid lossy >2^53 reads
export const int128 = () => new Column<string>('Int128')
export const int256 = () => new Column<string>('Int256')

export const uint8 = () => new Column<number>('UInt8')
export const uint16 = () => new Column<number>('UInt16')
export const uint32 = () => new Column<number>('UInt32')
export const uint64 = () => new Column<string>('UInt64')
export const uint128 = () => new Column<string>('UInt128')
export const uint256 = () => new Column<string>('UInt256')

export const float32 = () => new Column<number>('Float32')
export const float64 = () => new Column<number>('Float64')

export const decimal = (precision: number, scale: number) => {
  if (
    !Number.isInteger(precision) ||
    !Number.isInteger(scale) ||
    precision < 1 ||
    scale < 0 ||
    scale > precision
  ) {
    throw new Error(
      '[drizzle-clickhouse] decimal(precision, scale): precision >= 1, 0 <= scale <= precision',
    )
  }
  return new Column<string>(`Decimal(${precision}, ${scale})`)
}

export const date = () => new Column<string>('Date')
export const date32 = () => new Column<string>('Date32')
export const dateTime = (tz?: string) =>
  new Column<string>(tz ? `DateTime(${quoteStringLiteral(tz)})` : 'DateTime')
export const dateTime64 = (precision: number, tz?: string) => {
  if (!Number.isInteger(precision) || precision < 0 || precision > 9) {
    throw new Error(
      '[drizzle-clickhouse] dateTime64 precision must be an integer 0..9',
    )
  }
  return new Column<string>(
    tz
      ? `DateTime64(${precision}, ${quoteStringLiteral(tz)})`
      : `DateTime64(${precision})`,
  )
}

export const enum8 = <T extends Record<string, number>>(values: T) =>
  new Column<keyof T & string>(buildEnumDDL('Enum8', values))
export const enum16 = <T extends Record<string, number>>(values: T) =>
  new Column<keyof T & string>(buildEnumDDL('Enum16', values))

function buildEnumDDL(
  kind: 'Enum8' | 'Enum16',
  values: Record<string, number>,
): string {
  const entries = Object.entries(values)
  if (entries.length === 0) {
    throw new Error(`[drizzle-clickhouse] ${kind} requires at least one value`)
  }
  const body = entries
    .map(([k, v]) => `${quoteStringLiteral(k)} = ${v}`)
    .join(', ')
  return `${kind}(${body})`
}

// ── Composite constructors ─────────────────────────────────────────────────

export const array = <T>(inner: Column<T>) =>
  new Column<T[]>(`Array(${inner.ddlType})`)

/**
 * Wrap an inner column with `LowCardinality(...)`. Equivalent to
 * `inner.lowCardinality()`, kept around because the plan and Drizzle's
 * column-wrapper style both name it as a free function.
 */
export const lowCardinality = <TData, TInsert>(inner: Column<TData, TInsert>) =>
  inner.lowCardinality()

/**
 * Wrap an inner column with `Nullable(...)`. Same shape as
 * {@link lowCardinality}.
 */
export const nullable = <TData, TInsert>(inner: Column<TData, TInsert>) =>
  inner.nullable()

export const tuple = <T extends Column[]>(...inner: T) =>
  new Column<{ [K in keyof T]: T[K] extends Column<infer D> ? D : never }>(
    `Tuple(${inner.map((c) => c.ddlType).join(', ')})`,
  )

export const map = <K, V>(key: Column<K>, value: Column<V>) =>
  new Column<Map<K, V>>(`Map(${key.ddlType}, ${value.ddlType})`)

export const json = () => new Column<unknown>('JSON')

// ── Generic escape hatch ───────────────────────────────────────────────────

/** Declare a column with an arbitrary ClickHouse type string. */
export const raw = <T = unknown>(ddl: string) => new Column<T>(ddl)
