import { MergeTreeSettings, TableEngine } from './engines';
import { Schema } from './schema';
import { Infer, Shape } from './common';
import { getTableName, QueryFormatter } from './query_formatter';
import { ClickHouseClient } from '../client';
import { Row, Rows } from '../result';
import { WhereExpr } from './where';
import { InsertStream, SelectResult } from './stream';
import { ClickHouseSettings } from '../clickhouse_types';
import Stream from 'stream';
import { mapStream } from '../utils';
import { compactJson, decompactJson } from './compact';

// TODO: non-empty schema constraint
export interface TableOptions<S extends Shape> {
  name: string;
  schema: Schema<S>;
  database?: string;
}

export interface CreateTableOptions<S extends Shape> {
  engine: TableEngine;
  order_by: (keyof S)[]; // TODO: functions support
  if_not_exists?: boolean;
  on_cluster?: string;
  partition_by?: (keyof S)[]; // TODO: functions support
  primary_key?: (keyof S)[]; // TODO: functions support
  settings?: MergeTreeSettings; // TODO: more settings and type constraints
  clickhouse_settings?: ClickHouseSettings;
  // TODO: settings now moved to engines; decide whether we need it here
  // TODO: index
  // TODO: projections
  // TODO: TTL
}

export interface SelectOptions<S extends Shape> {
  // decompactJson?: (row: unknown[]) => Infer<S>;
  columns?: (keyof S)[];
  where?: WhereExpr<S>;
  order_by?: (keyof S)[];
  clickhouse_settings?: ClickHouseSettings;
  abort_signal?: AbortSignal;
  format?: 'JSONCompactEachRow' | 'JSON';
}

export interface InsertOptions<S extends Shape> {
  values: Infer<S>[] | InsertStream<Infer<S>>;
  // compactJson?: (value: Infer<S>) => unknown[];
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
    return this.client.command({ query });
  }

  insert({
    abort_signal,
    clickhouse_settings,
    values,
  }: InsertOptions<S>): Promise<void> {
    return this.client.insert({
      clickhouse_settings,
      abort_signal,
      table: getTableName(this.options),
      values: Array.isArray(values)
        ? values.map((value) => compactJson(this.options.schema.shape, value))
        : Stream.pipeline(
            values,
            mapStream((value) => compactJson(this.options.schema.shape, value)),
            (err) => {
              if (err) {
                console.error(err);
              }
            }
          ),
    });
  }

  async select({
    abort_signal,
    clickhouse_settings,
    columns,
    format,
    order_by,
    where,
  }: SelectOptions<S> = {}): Promise<SelectResult<Infer<S>>> {
    const query = QueryFormatter.select(this.options, where, columns, order_by);
    const rows = await this.client.command({
      query,
      clickhouse_settings,
      abort_signal,
      format: format ?? 'JSONCompactEachRow',
    });

    const stream = rows.asStream();
    const shape = this.options.schema.shape;
    async function* asyncGenerator() {
      for await (const row of stream) {
        yield decompactJson(shape, (row as Row).json()) as Infer<S>;
      }
    }

    return {
      asyncGenerator,
      json: async () => {
        const result = [];
        for await (const value of asyncGenerator()) {
          result.push(value);
        }
        return result;
      },
    };
  }
}
