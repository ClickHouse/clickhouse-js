/**
 * Public ClickHouse type tags used by the schema DSL and the dialect.
 *
 * These mirror the textual form that appears in CREATE TABLE statements,
 * minus modifiers like Nullable/Array/LowCardinality which are layered on
 * top by column-builder wrappers (see {@link ./schema/columns}).
 */
export type ScalarTypeTag =
  | 'String'
  | 'FixedString'
  | 'UUID'
  | 'IPv4'
  | 'IPv6'
  | 'Bool'
  | 'Int8'
  | 'Int16'
  | 'Int32'
  | 'Int64'
  | 'Int128'
  | 'Int256'
  | 'UInt8'
  | 'UInt16'
  | 'UInt32'
  | 'UInt64'
  | 'UInt128'
  | 'UInt256'
  | 'Float32'
  | 'Float64'
  | 'Decimal'
  | 'Date'
  | 'Date32'
  | 'DateTime'
  | 'DateTime64'
  | 'Enum8'
  | 'Enum16'
  | 'JSON'

/** Logger surface compatible with `@clickhouse/client-common` Logger but kept tiny. */
export interface DrizzleLogger {
  logQuery(query: string, params?: Record<string, unknown>): void
}

export class NoopLogger implements DrizzleLogger {
  logQuery(): void {
    /* no-op */
  }
}

export class ConsoleLogger implements DrizzleLogger {
  logQuery(query: string, params?: Record<string, unknown>): void {
    // eslint-disable-next-line no-console
    console.log('[drizzle-clickhouse]', query, params ?? {})
  }
}

/**
 * Thrown when the user invokes a Drizzle feature that doesn't map cleanly
 * to ClickHouse semantics (transactions, per-row UPDATE/DELETE w/o ALTER,
 * unique constraints, etc.).
 */
export class UnsupportedFeatureError extends Error {
  constructor(feature: string, hint?: string) {
    super(
      `[drizzle-clickhouse] ${feature} is not supported by ClickHouse.` +
        (hint ? ` ${hint}` : ''),
    )
    this.name = 'UnsupportedFeatureError'
  }
}
