import type { Shape } from './common'
import type { CreateTableOptions, TableOptions } from './index'
import type { WhereExpr } from './where'
import type { NonEmptyArray } from './common'

export const QueryFormatter = {
  // See https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree/#table_engine-mergetree-creating-a-table
  createTable: <S extends Shape>(
    tableOptions: TableOptions<S>,
    {
      engine: _engine,
      if_not_exists,
      on_cluster,
      order_by,
      partition_by,
      primary_key,
      settings: _settings,
    }: CreateTableOptions<S>
  ) => {
    const ifNotExist = if_not_exists ? ' IF NOT EXISTS' : ''
    const tableName = getTableName(tableOptions)
    const onCluster = on_cluster ? ` ON CLUSTER '${on_cluster}'` : ''
    const columns = ` (${tableOptions.schema.toString()})`
    const engine = ` ENGINE ${_engine}`
    const orderBy = order_by ? ` ORDER BY (${order_by.join(', ')})` : ''
    const partitionBy = partition_by
      ? ` PARTITION BY (${partition_by.join(', ')})`
      : ''
    const primaryKey = primary_key
      ? ` PRIMARY KEY (${primary_key.join(', ')})`
      : ''
    const settings =
      _settings && Object.keys(_settings).length
        ? ' SETTINGS ' +
          Object.entries(_settings)
            .map(([key, value]) => {
              const v = typeof value === 'string' ? `'${value}'` : value
              return `${key} = ${v}`
            })
            .join(', ')
        : ''
    return (
      `CREATE TABLE${ifNotExist} ${tableName}${onCluster}${columns}${engine}` +
      `${orderBy}${partitionBy}${primaryKey}${settings}`
    )
  },

  // https://clickhouse.com/docs/en/sql-reference/statements/select/
  select: <S extends Shape>(
    tableOptions: TableOptions<S>,
    whereExpr?: WhereExpr<S>,
    columns?: NonEmptyArray<keyof S>,
    orderBy?: NonEmptyArray<[keyof S, 'ASC' | 'DESC']>
  ) => {
    const tableName = getTableName(tableOptions)
    const where = whereExpr ? ` WHERE ${whereExpr.toString()}` : ''
    const cols = columns ? columns.join(', ') : '*'
    const order = orderBy
      ? ` ORDER BY ${orderBy
          .map(([column, order]) => `${column.toString()} ${order}`)
          .join(', ')}`
      : ''
    return `SELECT ${cols} FROM ${tableName}${where}${order}`
  },
}

export function getTableName<S extends Shape>({
  database,
  name,
}: TableOptions<S>) {
  return database !== undefined ? `${database}.${name}` : name
}
