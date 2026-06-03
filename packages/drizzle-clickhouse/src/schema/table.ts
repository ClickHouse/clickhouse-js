import type { SQL } from '../sql.js'
import type { Engine } from './engines.js'
import type { Column } from './columns.js'

/**
 * Options for the `clickhouseTable` table-config callback.
 *
 * `orderBy` is required for any MergeTree-family engine (ClickHouse will
 * reject CREATE TABLE otherwise); the dialect emits `ORDER BY tuple()` if you
 * pass an empty array, which is the canonical "no ordering" form.
 */
export interface TableConfig {
  engine: Engine
  orderBy?: ReadonlyArray<string | SQL>
  partitionBy?: SQL | string
  primaryKey?: ReadonlyArray<string>
  sampleBy?: SQL | string
  ttl?: SQL
  settings?: Record<string, string | number | boolean>
  cluster?: string
  comment?: string
}

export type TableColumns = Readonly<Record<string, Column<unknown, unknown>>>

/**
 * A schema-level handle to a ClickHouse table. Returned from
 * {@link clickhouseTable}; the `_` property carries the row-shape types used
 * by `$inferSelect`/`$inferInsert`.
 */
export class Table<TColumns extends TableColumns = TableColumns> {
  declare readonly $inferSelect: {
    [K in keyof TColumns]: TColumns[K]['_']['data']
  }
  declare readonly $inferInsert: {
    [K in keyof TColumns]: TColumns[K]['_']['insert']
  }

  constructor(
    readonly name: string,
    readonly columns: TColumns,
    readonly config: TableConfig,
    readonly database?: string,
  ) {
    // Populate clickhouseName from the JS key when the user didn't override it.
    for (const [key, col] of Object.entries(columns) as [string, Column][]) {
      if (col.clickhouseName === undefined) col.clickhouseName = key
    }
  }

  /** Fully-qualified `db.table` identifier (without backticks). */
  qualifiedName(defaultDatabase?: string): string {
    const db = this.database ?? defaultDatabase
    return db ? `${db}.${this.name}` : this.name
  }
}

/**
 * Declare a ClickHouse table.
 *
 *   const events = clickhouseTable(
 *     'events',
 *     {
 *       ts: dateTime64(3),
 *       userId: uint64(),
 *       kind: lowCardinality(string()),
 *     },
 *     () => ({ engine: mergeTree(), orderBy: ['ts', 'userId'] }),
 *   )
 */
export function clickhouseTable<TColumns extends TableColumns>(
  name: string,
  columns: TColumns,
  configFn: (columns: TColumns) => TableConfig,
  options?: { database?: string },
): Table<TColumns> {
  return new Table(name, columns, configFn(columns), options?.database)
}
