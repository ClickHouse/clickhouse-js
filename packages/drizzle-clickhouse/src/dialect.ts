import { compile, SQL, sql as sqlTag, type CompiledSQL } from './sql.js'
import {
  quoteIdentifier,
  quoteQualifiedIdentifier,
  quoteStringLiteral,
} from './escape.js'
import type { Table } from './schema/table.js'
import type { Column } from './schema/columns.js'

/**
 * The ClickHouse dialect. Pure SQL generation — no driver concerns.
 * Holds a couple of cross-cutting defaults (default database, `mutations_sync`)
 * that get woven into emitted DDL/DML.
 */
export class ClickHouseDialect {
  constructor(
    readonly options: {
      database?: string
    } = {},
  ) {}

  // ── DDL ────────────────────────────────────────────────────────────────

  createTable(table: Table, opts: { ifNotExists?: boolean } = {}): CompiledSQL {
    const { columns, config } = table
    const cols = (Object.entries(columns) as [string, Column][]).map(
      ([key, col]) => this.renderColumnDef(col.clickhouseName ?? key, col),
    )
    const lines: string[] = []
    lines.push(
      `CREATE TABLE${opts.ifNotExists ? ' IF NOT EXISTS' : ''} ${quoteQualifiedIdentifier(
        table.qualifiedName(this.options.database),
      )}${config.cluster ? ` ON CLUSTER ${quoteIdentifier(config.cluster)}` : ''}`,
    )
    lines.push('(')
    lines.push('  ' + cols.join(',\n  '))
    lines.push(')')
    lines.push(`ENGINE = ${config.engine.clause}`)

    if (config.orderBy !== undefined) {
      lines.push(`ORDER BY ${this.renderOrderBy(config.orderBy)}`)
    }
    if (config.partitionBy !== undefined) {
      lines.push(`PARTITION BY ${this.renderExprOrIdent(config.partitionBy)}`)
    }
    if (config.primaryKey !== undefined && config.primaryKey.length > 0) {
      lines.push(
        `PRIMARY KEY (${config.primaryKey.map(quoteIdentifier).join(', ')})`,
      )
    }
    if (config.sampleBy !== undefined) {
      lines.push(`SAMPLE BY ${this.renderExprOrIdent(config.sampleBy)}`)
    }
    if (config.ttl !== undefined) {
      lines.push(`TTL ${compile(config.ttl).sql}`)
    }
    if (config.settings && Object.keys(config.settings).length > 0) {
      const kv = Object.entries(config.settings)
        .map(([k, v]) => `${k} = ${this.renderSettingValue(v)}`)
        .join(', ')
      lines.push(`SETTINGS ${kv}`)
    }
    if (config.comment !== undefined) {
      lines.push(`COMMENT ${quoteStringLiteral(config.comment)}`)
    }
    return { sql: lines.join('\n'), params: {} }
  }

  dropTable(
    table: Table,
    opts: { ifExists?: boolean; sync?: boolean } = {},
  ): CompiledSQL {
    const fq = quoteQualifiedIdentifier(
      table.qualifiedName(this.options.database),
    )
    const parts = ['DROP TABLE']
    if (opts.ifExists) parts.push('IF EXISTS')
    parts.push(fq)
    if (table.config.cluster) {
      parts.push(`ON CLUSTER ${quoteIdentifier(table.config.cluster)}`)
    }
    if (opts.sync) parts.push('SYNC')
    return { sql: parts.join(' '), params: {} }
  }

  truncateTable(table: Table, opts: { ifExists?: boolean } = {}): CompiledSQL {
    const fq = quoteQualifiedIdentifier(
      table.qualifiedName(this.options.database),
    )
    const parts = ['TRUNCATE TABLE']
    if (opts.ifExists) parts.push('IF EXISTS')
    parts.push(fq)
    if (table.config.cluster) {
      parts.push(`ON CLUSTER ${quoteIdentifier(table.config.cluster)}`)
    }
    return { sql: parts.join(' '), params: {} }
  }

  // ── DML ────────────────────────────────────────────────────────────────

  /**
   * Build a SELECT statement. The "where" / "having" / "limitBy" clauses are
   * accepted as compiled {@link SQL} fragments so users can mix in placeholders
   * via the `sql` tag.
   */
  select(plan: SelectPlan): CompiledSQL {
    const lines: string[] = []
    const accParams: Record<string, unknown> = {}

    if (plan.with && plan.with.length > 0) {
      const parts = plan.with.map((w) => {
        const c = compile(w.query)
        Object.assign(accParams, c.params)
        return `${quoteIdentifier(w.name)} AS (${c.sql})`
      })
      lines.push(`WITH ${parts.join(', ')}`)
    }

    const projection = plan.columns ?? ['*']
    const projectionText = projection
      .map((p) => {
        if (typeof p === 'string') return p === '*' ? '*' : quoteIdentifier(p)
        const c = compile(p.expr)
        Object.assign(accParams, c.params)
        return p.alias ? `${c.sql} AS ${quoteIdentifier(p.alias)}` : c.sql
      })
      .join(', ')
    lines.push(`SELECT ${projection.length === 0 ? '*' : projectionText}`)

    if (plan.from) {
      lines.push(
        `FROM ${this.renderFrom(plan.from)}${plan.final ? ' FINAL' : ''}`,
      )
    }

    if (plan.where) {
      const c = compile(plan.where)
      Object.assign(accParams, c.params)
      lines.push(`WHERE ${c.sql}`)
    }
    if (plan.groupBy && plan.groupBy.length > 0) {
      lines.push(
        `GROUP BY ${plan.groupBy
          .map((g) =>
            typeof g === 'string'
              ? quoteIdentifier(g)
              : compileInto(g, accParams),
          )
          .join(', ')}`,
      )
    }
    if (plan.having) {
      const c = compile(plan.having)
      Object.assign(accParams, c.params)
      lines.push(`HAVING ${c.sql}`)
    }
    if (plan.orderBy && plan.orderBy.length > 0) {
      lines.push(
        `ORDER BY ${plan.orderBy
          .map((o) => {
            const expr =
              typeof o.expr === 'string'
                ? quoteIdentifier(o.expr)
                : compileInto(o.expr, accParams)
            return `${expr} ${o.direction ?? 'ASC'}`
          })
          .join(', ')}`,
      )
    }
    if (plan.limit !== undefined) {
      lines.push(
        `LIMIT ${plan.limit}${plan.offset !== undefined ? ` OFFSET ${plan.offset}` : ''}`,
      )
    }
    if (plan.settings && Object.keys(plan.settings).length > 0) {
      const kv = Object.entries(plan.settings)
        .map(([k, v]) => `${k} = ${this.renderSettingValue(v)}`)
        .join(', ')
      lines.push(`SETTINGS ${kv}`)
    }

    return { sql: lines.join('\n'), params: accParams }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private renderColumnDef(name: string, col: Column): string {
    const parts: string[] = [quoteIdentifier(name), col.ddlType]
    if (col._hasDefault) {
      const keyword =
        col._defaultKind === 'materialized'
          ? 'MATERIALIZED'
          : col._defaultKind === 'alias'
            ? 'ALIAS'
            : col._defaultKind === 'ephemeral'
              ? 'EPHEMERAL'
              : 'DEFAULT'
      if (col._default === undefined && col._defaultKind === 'ephemeral') {
        parts.push(keyword)
      } else {
        parts.push(`${keyword} ${this.renderDefaultLiteral(col._default)}`)
      }
    }
    if (col._codec) parts.push(`CODEC(${col._codec})`)
    if (col._ttl) parts.push(`TTL ${compile(col._ttl).sql}`)
    if (col._comment !== undefined) {
      parts.push(`COMMENT ${quoteStringLiteral(col._comment)}`)
    }
    return parts.join(' ')
  }

  private renderDefaultLiteral(value: unknown): string {
    if (value instanceof SQL) return compile(value).sql
    if (value === null) return 'NULL'
    if (typeof value === 'string') return quoteStringLiteral(value)
    if (typeof value === 'number' || typeof value === 'bigint')
      return String(value)
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    if (value instanceof Date) return quoteStringLiteral(value.toISOString())
    return quoteStringLiteral(JSON.stringify(value))
  }

  private renderOrderBy(orderBy: ReadonlyArray<string | SQL>): string {
    if (orderBy.length === 0) return 'tuple()'
    return orderBy
      .map((o) => (typeof o === 'string' ? quoteIdentifier(o) : compile(o).sql))
      .join(', ')
  }

  private renderExprOrIdent(value: SQL | string): string {
    return typeof value === 'string'
      ? quoteIdentifier(value)
      : compile(value).sql
  }

  private renderSettingValue(v: string | number | boolean): string {
    if (typeof v === 'string') return quoteStringLiteral(v)
    if (typeof v === 'boolean') return v ? '1' : '0'
    return String(v)
  }

  private renderFrom(from: FromClause): string {
    if (typeof from === 'string') {
      return quoteQualifiedIdentifier(from)
    }
    if ('table' in from) {
      const qn = quoteQualifiedIdentifier(
        from.table.qualifiedName(this.options.database),
      )
      return from.alias ? `${qn} AS ${quoteIdentifier(from.alias)}` : qn
    }
    // Subquery
    const c = compile(from.subquery)
    return `(${c.sql})${from.alias ? ` AS ${quoteIdentifier(from.alias)}` : ''}`
  }
}

function compileInto(s: SQL, into: Record<string, unknown>): string {
  const c = compile(s)
  Object.assign(into, c.params)
  return c.sql
}

// ── Plan types ───────────────────────────────────────────────────────────

export type FromClause =
  | string
  | { table: Table; alias?: string }
  | { subquery: SQL; alias?: string }

export interface Projection {
  expr: SQL
  alias?: string
}

export interface WithClause {
  name: string
  query: SQL
}

export interface OrderByClause {
  expr: string | SQL
  direction?: 'ASC' | 'DESC'
}

export interface SelectPlan {
  with?: ReadonlyArray<WithClause>
  columns?: ReadonlyArray<string | Projection>
  from?: FromClause
  final?: boolean
  where?: SQL
  groupBy?: ReadonlyArray<string | SQL>
  having?: SQL
  orderBy?: ReadonlyArray<OrderByClause>
  limit?: number
  offset?: number
  settings?: Record<string, string | number | boolean>
}

// Re-export for convenience.
export { sqlTag as sql }

// Used by table.test.ts and others
export { compile } from './sql.js'
export type { Table, TableConfig } from './schema/table.js'
