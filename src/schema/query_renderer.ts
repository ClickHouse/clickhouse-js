import { Shape } from './common';
import { CreateTableOptions, Infer, TableOptions } from './index';

export const QueryRenderer = {
  // See https://clickhouse.com/docs/en/engines/table-engines/mergetree-family/mergetree/#table_engine-mergetree-creating-a-table
  createTable: <S extends Shape>(
    tableOptions: TableOptions<S>,
    createTableOptions: CreateTableOptions
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
      `CREATE TABLE${ifNotExist}${tableName}${onCluster}${columns}${engine}` +
      `${orderBy}${partitionBy}${primaryKey}${settings}`
    );
  },

  // https://clickhouse.com/docs/en/sql-reference/statements/insert-into
  insert: <S extends Shape>(
    tableOptions: TableOptions<S>,
    rows: Infer<S>[]
  ) => {
    const tableName = getTableName(tableOptions);
    // FIXME: likely the order of the columns might be off here
    const values = rows
      .map((row) => {
        // Maybe replace with `Object.keys` and a bit uglier code for better performance
        return `(${Object.entries(row)
          .map(([, v]) => v)
          .join(', ')})`;
      })
      .join(', ');
    return `INSERT INTO ${tableName} VALUES ${values}`;
  },
};

export function getTableName<S extends Shape>({
  database,
  name,
}: TableOptions<S>) {
  return database !== undefined ? ` ${database}.${name}` : ` ${name}`;
}
