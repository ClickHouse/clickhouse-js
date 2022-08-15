import { MergeTreeSettings, TableEngine } from './engines';
import { Schema } from './schema';
import { Infer, Shape } from './common';
import { getTableName, QueryFormatter } from './query_formatter';
import { ClickHouseClient } from '../client';
import { Row, Rows } from '../result';
import { WhereExpr } from './where';
import { InsertStream, SelectStream } from './stream';
import { ClickHouseSettings } from '../clickhouse_types';

// TODO: non-empty schema constraint
export interface TableOptions<S extends Shape> {
  name: string;
  schema: Schema<S>;
  database?: string;
}

export interface CreateTableOptions<S extends Shape> {
  engine: TableEngine;
  orderBy: (keyof S)[]; // TODO: functions support
  ifNotExist?: boolean;
  onCluster?: string;
  partitionBy?: (keyof S)[]; // TODO: functions support
  primaryKey?: (keyof S)[]; // TODO: functions support
  settings?: MergeTreeSettings; // TODO: more settings and type constraints
  // TODO: settings now moved to engines; decide whether we need it here
  // TODO: index
  // TODO: projections
  // TODO: TTL
}

export interface SelectOptions<S extends Shape> {
  columns?: (keyof S)[];
  where?: WhereExpr<S>;
  orderBy?: (keyof S)[];
  clickhouse_settings?: ClickHouseSettings;
  abort_signal?: AbortSignal;
}

export interface InsertOptions<S extends Shape> {
  values: Infer<S>[] | InsertStream<Infer<S>>;
  clickhouse_settings?: ClickHouseSettings;
  abort_signal?: AbortSignal;
}

export class Table<S extends Shape> {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly options: TableOptions<S>
  ) {}

  create(options: CreateTableOptions<S>): Promise<Rows> {
    const query = QueryFormatter.createTable(this.options, options);
    // TODO consume Rows into something else?
    return this.client.command({ query, format: 'JSONCompactEachRow' });
  }

  insert(options: InsertOptions<S>): Promise<void> {
    return this.client.insert({
      table: getTableName(this.options),
      ...options,
    });
  }

  async select(options: SelectOptions<S>): Promise<SelectStream<Infer<S>>> {
    const { columns, where, orderBy } = options;
    const query = QueryFormatter.select(this.options, where, columns, orderBy);
    const rows = await this.client.command({
      query,
      format: 'JSONCompactEachRow',
    });
    return {
      onData(cb: (t: Infer<S>) => void): void {
        rows.asStream().on('data', (row: Row) => {
          cb(row.json());
        });
      },
      asArray(): Promise<Infer<S>[]> {
        return rows.json();
      },
    };
  }
}
