import type { Table, TableColumns } from '../schema/table.js'

/**
 * INSERT builder. Per the plan, bulk inserts go through the native
 * `client.insert({ format: 'JSONEachRow' })` path rather than building a giant
 * VALUES string — orders of magnitude faster, lossless for big numbers, and
 * matches how the existing examples in this repo write to ClickHouse.
 *
 * The builder is intentionally a thin descriptor; execution lives in the
 * session adapters which speak to the underlying driver.
 */
export class InsertBuilder<T extends TableColumns> {
  private _values: ReadonlyArray<Record<string, unknown>> = []
  private _columnSubset: ReadonlyArray<string> | undefined

  constructor(readonly table: Table<T>) {}

  /** Restrict the inserted column list. */
  columns(names: ReadonlyArray<keyof T & string>): this {
    this._columnSubset = names
    return this
  }

  /** Single-row or multi-row insert. Values must match `$inferInsert`. */
  values(
    rows:
      | { [K in keyof T]: T[K]['_']['insert'] }
      | ReadonlyArray<{ [K in keyof T]: T[K]['_']['insert'] }>,
  ): this {
    this._values = Array.isArray(rows)
      ? rows
      : [rows as Record<string, unknown>]
    return this
  }

  /** Snapshot for the session adapter to consume. */
  toPlan(): {
    table: Table<T>
    values: ReadonlyArray<Record<string, unknown>>
    columns?: ReadonlyArray<string>
  } {
    return {
      table: this.table,
      values: this._values,
      columns: this._columnSubset,
    }
  }
}
