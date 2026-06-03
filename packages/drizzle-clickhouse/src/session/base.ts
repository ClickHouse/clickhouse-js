import type { CompiledSQL } from '../sql.js'
import { ClickHouseDialect } from '../dialect.js'
import type { DrizzleLogger } from '../types.js'
import { NoopLogger, UnsupportedFeatureError } from '../types.js'
import { SelectBuilder } from '../query-builders/select.js'
import { InsertBuilder } from '../query-builders/insert.js'
import type { Table, TableColumns } from '../schema/table.js'
import { compile, type SQL } from '../sql.js'

/**
 * Driver-agnostic interface that any underlying ClickHouse client must
 * implement for the adapter to use it.
 *
 * Both `@clickhouse/client` and `@clickhouse/client-web` already expose this
 * surface — see {@link ./node} and {@link ./web} for the trivial adapters.
 */
export interface ClickHouseClientLike {
  query(args: {
    query: string
    query_params?: Record<string, unknown>
    format?: string
    clickhouse_settings?: Record<string, unknown>
    abort_signal?: AbortSignal
  }): Promise<{ json<T>(): Promise<T[] | T> }>

  command(args: {
    query: string
    query_params?: Record<string, unknown>
    clickhouse_settings?: Record<string, unknown>
    abort_signal?: AbortSignal
  }): Promise<unknown>

  insert(args: {
    table: string
    values:
      | ReadonlyArray<Record<string, unknown>>
      | NodeJS.ReadableStream
      | ReadableStream
    format?: string
    columns?: ReadonlyArray<string>
    clickhouse_settings?: Record<string, unknown>
    abort_signal?: AbortSignal
  }): Promise<unknown>

  close?(): Promise<void>
}

export interface DrizzleOptions {
  /** Override the default `database` used to qualify table names. */
  database?: string
  /** Default ClickHouse settings injected into every query/insert/command. */
  defaultSettings?: Record<string, unknown>
  /** Default `mutations_sync` for ALTER UPDATE/DELETE/OPTIMIZE (Phase 2). */
  mutationsSync?: 0 | 1 | 2
  /** Custom logger; defaults to {@link NoopLogger}. */
  logger?: DrizzleLogger | boolean
}

/**
 * The user-facing handle returned from `drizzle(client)`. Routes
 * select/insert/raw queries to the underlying driver and the dialect.
 */
export class ClickHouseDatabase {
  readonly dialect: ClickHouseDialect

  constructor(
    readonly client: ClickHouseClientLike,
    readonly options: DrizzleOptions = {},
  ) {
    this.dialect = new ClickHouseDialect({ database: options.database })
  }

  private get logger(): DrizzleLogger {
    if (this.options.logger === true) {
      // Lazy-load to avoid no-console lint hits in non-debug paths.
      return {
        logQuery: (q, p) => {
          // eslint-disable-next-line no-console
          console.log('[drizzle-clickhouse]', q, p ?? {})
        },
      }
    }
    if (this.options.logger && typeof this.options.logger === 'object') {
      return this.options.logger
    }
    return new NoopLogger()
  }

  /** Start a SELECT. Chain `.from(table)` to type the row. */
  select(columns?: ReadonlyArray<string>): SelectBuilder {
    const sb = new SelectBuilder(this.dialect)
    if (columns) sb.select(columns)
    return sb
  }

  /** Start an INSERT. */
  insert<T extends TableColumns>(table: Table<T>): InsertBuilder<T> {
    return new InsertBuilder(table)
  }

  // ── Execution ────────────────────────────────────────────────────────

  /** Compile a select builder and execute it, returning typed rows. */
  async run<TRow>(builder: SelectBuilder<TRow>): Promise<TRow[]> {
    const compiled = builder.toSQL()
    return this.executeSelect<TRow>(compiled)
  }

  /** Execute an INSERT builder against the driver via the native `insert` path. */
  async runInsert<T extends TableColumns>(
    builder: InsertBuilder<T>,
  ): Promise<void> {
    const plan = builder.toPlan()
    if (plan.values.length === 0) return
    this.logger.logQuery(
      `INSERT INTO ${plan.table.qualifiedName(this.options.database)}`,
    )
    await this.client.insert({
      table: plan.table.qualifiedName(this.options.database),
      values: plan.values,
      format: 'JSONEachRow',
      columns: plan.columns,
      clickhouse_settings: this.options.defaultSettings,
    })
  }

  /** Execute a raw `sql` fragment, returning rows. */
  async execute<T = unknown>(query: SQL): Promise<T[]> {
    const compiled = compile(query)
    return this.executeSelect<T>(compiled)
  }

  /**
   * Execute a raw command (DDL / DROP / TRUNCATE / OPTIMIZE / SYSTEM …),
   * returning nothing. Use this for any statement that doesn't produce a
   * row stream.
   */
  async command(query: SQL): Promise<void> {
    const compiled = compile(query)
    this.logger.logQuery(compiled.sql, compiled.params)
    await this.client.command({
      query: compiled.sql,
      query_params: compiled.params,
      clickhouse_settings: this.options.defaultSettings,
    })
  }

  // ── DDL helpers ─────────────────────────────────────────────────────

  async createTable(
    table: Table,
    opts?: { ifNotExists?: boolean },
  ): Promise<void> {
    const c = this.dialect.createTable(table, opts)
    this.logger.logQuery(c.sql, c.params)
    await this.client.command({
      query: c.sql,
      query_params: c.params,
      clickhouse_settings: this.options.defaultSettings,
    })
  }

  async dropTable(
    table: Table,
    opts?: { ifExists?: boolean; sync?: boolean },
  ): Promise<void> {
    const c = this.dialect.dropTable(table, opts)
    this.logger.logQuery(c.sql, c.params)
    await this.client.command({
      query: c.sql,
      query_params: c.params,
      clickhouse_settings: this.options.defaultSettings,
    })
  }

  async truncateTable(
    table: Table,
    opts?: { ifExists?: boolean },
  ): Promise<void> {
    const c = this.dialect.truncateTable(table, opts)
    this.logger.logQuery(c.sql, c.params)
    await this.client.command({
      query: c.sql,
      query_params: c.params,
      clickhouse_settings: this.options.defaultSettings,
    })
  }

  /**
   * ClickHouse has no general transactions; we throw rather than silently
   * losing atomicity guarantees. Users who explicitly want a "no-op block"
   * can pass `{ allowNoTx: true }`, which simply invokes the callback with
   * `this`.
   */
  async transaction<T>(
    fn: (tx: ClickHouseDatabase) => Promise<T>,
    opts: { allowNoTx?: boolean } = {},
  ): Promise<T> {
    if (!opts.allowNoTx) {
      throw new UnsupportedFeatureError(
        'transaction()',
        'Pass { allowNoTx: true } to acknowledge that statements will execute without atomicity.',
      )
    }
    return fn(this)
  }

  private async executeSelect<T>(compiled: CompiledSQL): Promise<T[]> {
    this.logger.logQuery(compiled.sql, compiled.params)
    const rs = await this.client.query({
      query: compiled.sql,
      query_params: compiled.params,
      format: 'JSONEachRow',
      clickhouse_settings: this.options.defaultSettings,
    })
    const json = await rs.json<T>()
    return Array.isArray(json) ? json : [json]
  }
}
