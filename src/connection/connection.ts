import Stream from 'stream';
import type { ClickHouseSettings } from '../clickhouse_types';
import { HttpAdapter } from './adapter';

export interface ConnectionParams {
  host: string;

  connect_timeout: number;
  request_timeout: number;
  // max_open_connections: number;

  username: string;
  password: string;
}

export interface BaseParams {
  query: string;
  clickhouse_settings?: ClickHouseSettings;
  query_params?: Record<string, unknown>;
}

export interface InsertParams extends BaseParams {
  values: string | Stream.Readable;
}

export interface Connection {
  ping(): Promise<boolean>;
  close(): Promise<void>;
  select(params: BaseParams): Promise<Stream.Readable>
  command(params: BaseParams): Promise<void>
  insert(params: InsertParams): Promise<void>
}

export function createConnection(config: ConnectionParams): Connection {
  const url = new URL(config.host);
  if(url.protocol === 'http:' || url.protocol === 'https:') {
    return new HttpAdapter(config);
  }
  throw new Error('Only http adapter is supported');
}