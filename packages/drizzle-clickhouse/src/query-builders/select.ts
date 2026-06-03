import type {
  ClickHouseDialect,
  FromClause,
  OrderByClause,
  Projection,
  SelectPlan,
  WithClause,
} from '../dialect.js'
import type { CompiledSQL, SQL } from '../sql.js'
import type { Table, TableColumns } from '../schema/table.js'

/**
 * Lightweight SELECT builder. Mirrors enough of Drizzle's surface that
 * casual users feel at home; defers to the dialect for SQL generation so
 * we don't lock ourselves into Drizzle's internal AST shape.
 */
export class SelectBuilder<TRow = unknown> {
  private plan: SelectPlan = {}

  constructor(private readonly dialect: ClickHouseDialect) {}

  with(...ctes: WithClause[]): this {
    this.plan = { ...this.plan, with: [...(this.plan.with ?? []), ...ctes] }
    return this
  }

  select(columns: ReadonlyArray<string | Projection>): this {
    this.plan = { ...this.plan, columns }
    return this
  }

  from<T extends TableColumns>(
    source:
      | Table<T>
      | { table: Table<T>; alias?: string }
      | { subquery: SQL; alias?: string }
      | string,
  ): SelectBuilder<
    T extends TableColumns ? { [K in keyof T]: T[K]['_']['data'] } : TRow
  > {
    let from: FromClause
    if (typeof source === 'string') {
      from = source
    } else if ('table' in source) {
      from = { table: source.table as unknown as Table, alias: source.alias }
    } else if ('subquery' in source) {
      from = source
    } else {
      from = { table: source as unknown as Table }
    }
    this.plan = { ...this.plan, from }
    return this as unknown as SelectBuilder<
      T extends TableColumns ? { [K in keyof T]: T[K]['_']['data'] } : TRow
    >
  }

  final(): this {
    this.plan = { ...this.plan, final: true }
    return this
  }

  where(condition: SQL): this {
    this.plan = { ...this.plan, where: condition }
    return this
  }

  groupBy(...columns: ReadonlyArray<string | SQL>): this {
    this.plan = { ...this.plan, groupBy: columns }
    return this
  }

  having(condition: SQL): this {
    this.plan = { ...this.plan, having: condition }
    return this
  }

  orderBy(...order: OrderByClause[]): this {
    this.plan = { ...this.plan, orderBy: order }
    return this
  }

  limit(n: number): this {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        '[drizzle-clickhouse] limit must be a non-negative integer',
      )
    }
    this.plan = { ...this.plan, limit: n }
    return this
  }

  offset(n: number): this {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(
        '[drizzle-clickhouse] offset must be a non-negative integer',
      )
    }
    this.plan = { ...this.plan, offset: n }
    return this
  }

  settings(s: Record<string, string | number | boolean>): this {
    this.plan = {
      ...this.plan,
      settings: { ...(this.plan.settings ?? {}), ...s },
    }
    return this
  }

  /** Compile to text + params without executing. Useful for tests/debugging. */
  toSQL(): CompiledSQL {
    return this.dialect.select(this.plan)
  }

  /** Snapshot of the underlying plan (read-only). */
  getPlan(): Readonly<SelectPlan> {
    return this.plan
  }
}
