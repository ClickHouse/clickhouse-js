import { Shape } from './common';
import { CreateTableOptions, TableOptions } from './index';
import { WhereExpr } from './where';

export const QueryFormatter = {
  // See https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree/#table_engine-mergetree-creating-a-table
  createTable: <S extends Shape>(
    tableOptions: TableOptions<S>,
    createTableOptions: CreateTableOptions<S>
  ) => {
    const ifNotExist = createTableOptions.ifNotExist ? ' IF NOT EXISTS' : '';
    const tableName = getTableName(tableOptions);
    const onCluster = createTableOptions.onCluster
      ? ` ON CLUSTER '${createTableOptions.onCluster}'`
      : '';
    const columns = ` (${tableOptions.schema.toString()})`;
    const engine = ` ENGINE ${createTableOptions.engine}`;
    const orderBy = createTableOptions.orderBy
      ? ` ORDER BY (${createTableOptions.orderBy.join(', ')})`
      : '';
    const partitionBy = createTableOptions.partitionBy
      ? ` PARTITION BY (${createTableOptions.partitionBy.join(', ')})`
      : '';
    const primaryKey = createTableOptions.primaryKey
      ? ` PRIMARY KEY (${createTableOptions.primaryKey.join(', ')})`
      : '';
    const settings =
      createTableOptions.engine.type === 'MergeTree' &&
      createTableOptions.settings &&
      Object.keys(createTableOptions.settings).length > 0
        ? ` SETTINGS ${Object.entries(createTableOptions.settings)
            .map(([k, v]) => `${k} = ${v}`)
            .join(', ')}`
        : '';
    return (
      `CREATE TABLE${ifNotExist} ${tableName}${onCluster}${columns}${engine}` +
      `${orderBy}${partitionBy}${primaryKey}${settings}`
    );
  },

  // https://clickhouse.com/docs/en/sql-reference/statements/select/
  select: <S extends Shape>(
    tableOptions: TableOptions<S>,
    whereExpr?: WhereExpr<S>,
    columns?: Array<keyof S>,
    orderBy?: Array<keyof S>
  ) => {
    const tableName = getTableName(tableOptions);
    const where = whereExpr ? ` WHERE ${whereExpr.toString()}` : '';
    const cols = columns ? columns.join(', ') : '*';
    const order = orderBy ? ` ORDER BY ${orderBy?.join(', ')}` : '';
    return `SELECT ${cols} FROM ${tableName}${where}${order}`;
  },
};

export function getTableName<S extends Shape>({
  database,
  name,
}: TableOptions<S>) {
  return database !== undefined ? `${database}.${name}` : name;
}
