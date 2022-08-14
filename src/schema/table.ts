import { MergeTreeSettings, TableEngine } from './engines';
import { Infer, Schema } from './schema';
import { Shape } from './common';
import { getTableName, QueryRenderer } from './query_renderer';
import { ClickHouseClient } from '../client';
import { Rows } from '../result';

// TODO: non-empty schema constraint
export interface TableOptions<S extends Shape> {
  name: string;
  schema: Schema<S>;
  database?: string;
}

export interface CreateTableOptions {
  engine: TableEngine;
  ifNotExist?: boolean;
  onCluster?: string;
  orderBy?: string[]; // TODO: schema constraint, functions support
  partitionBy?: string[]; // TODO: schema constraint, functions support
  primaryKey?: string[]; // TODO: schema constraint, functions support
  settings?: MergeTreeSettings; // TODO: more settings and type constraints
  // TODO: settings now moved to engines; decide whether we need it here
  // TODO: index
  // TODO: projections
  // TODO: TTL
}

export class Table<S extends Shape> {
  constructor(
    private readonly client: ClickHouseClient,
    private readonly options: TableOptions<S>
  ) {}

  create(options: CreateTableOptions): Promise<Rows> {
    const query = QueryRenderer.createTable(this.options, options);
    // TODO consume Rows into something else?
    return this.client.command({ query });
  }

  insert(rows: Infer<S>[]): Promise<void> {
    // TODO: formats
    // TODO: stream
    return this.client.insert({
      table: getTableName(this.options),
      values: rows,
    });
  }
}
