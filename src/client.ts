import Stream from 'stream';
// import type { ConnectionOptions as TlsOptions } from 'tls'
import type { ClickHouseSettings } from './clickhouse_types';
import { type Connection, createConnection } from './connection';
import * as Logger from './logger';
import { isStream, mapStream } from './utils';
import { type DataFormat, encode } from './data_formatter';
import { Rows } from './result';

export interface ClickHouseClientConfigOptions {
  host?: string;
  connect_timeout?: number;
  request_timeout?: number;
  // max_open_connections?: number;

  // compression?: {
  //   read?: boolean;
  //   write?: boolean;
  // }
  // tls?: TlsOptions;

  username?: string;
  password?: string;

  application?: string;
  database?: string;
  clickhouse_settings?: ClickHouseSettings;
  log?: {
    enable?: boolean;
  };
}

export interface BaseParams {
  clickhouse_settings?: ClickHouseSettings;
  query_params?: Record<string, unknown>;
}

export interface SelectParams extends BaseParams {
  query: string;
  format?: DataFormat;
}

export interface CommandParams extends BaseParams {
  query: string;
}

export interface InsertParams extends BaseParams {
  table: string;
  values: ReadonlyArray<any> | Stream.Readable;
}

function validateConfig(config: Required<ClickHouseClientConfigOptions>): void {
  const host = new URL(config.host);
  if (host.protocol !== 'http:' && host.protocol !== 'https:') {
    throw new Error(
      `Only http(s) protocol is supported, but given: [${host.protocol}]`
    );
  }
  // TODO add SSL validation
}

export class ClickHouseClient {
  private readonly config: Required<ClickHouseClientConfigOptions>;
  private readonly connection: Connection;

  constructor(config: ClickHouseClientConfigOptions = {}) {
    const loggingEnabled = Boolean(
      config.log?.enable || process.env.CLICKHOUSE_LOG_ENABLE
    );
    if (loggingEnabled) {
      Logger.enable();
    } else {
      Logger.disable();
    }

    this.config = {
      host: config.host ?? 'http://localhost:8123',
      connect_timeout: config.connect_timeout ?? 10_000,
      request_timeout: config.request_timeout ?? 300_000,
      // max_open_connections: options.max_open_connections ?? 256,
      // tls: _config.tls,
      // compression:
      username: config.username ?? 'default',
      password: config.password ?? '',
      application: config.password ?? 'clickhouse-js',
      database: config.password ?? 'default',
      clickhouse_settings: config.clickhouse_settings ?? {},
      log: {
        enable: loggingEnabled,
      },
    };

    validateConfig(this.config);
    this.connection = createConnection(this.config);
  }

  private getBaseParams(params: BaseParams) {
    return {
      clickhouse_settings: {
        ...this.config.clickhouse_settings,
        ...params.clickhouse_settings,
      },
      query_params: {
        database: this.config.database,
        ...params.query_params,
      },
    };
  }

  async select(params: SelectParams): Promise<Rows> {
    validateSelectQuery(params.query);
    const format = params.format ?? 'JSON';
    const query = formatSelectQuery(params.query, format);

    Logger.log('query: ', query);

    const stream = await this.connection.select({
      query,
      ...this.getBaseParams(params),
    });

    return new Rows(stream, format);
  }

  async command(params: CommandParams): Promise<void> {
    const query = params.query.trim();

    Logger.log('query: ', query);

    await this.connection.command({
      query,
      ...this.getBaseParams(params),
    });
  }

  async insert(params: InsertParams): Promise<void> {
    validateInsertValues(params.values);

    const query = `INSERT into ${params.table.trim()} FORMAT JSONCompactEachRow`;

    Logger.log('query: ', query);

    await this.connection.insert({
      query,
      values: encodeValues(params.values, 'JSONCompactEachRow'),
      ...this.getBaseParams(params),
    });
  }

  async ping(): Promise<boolean> {
    return await this.connection.ping();
  }

  async close(): Promise<void> {
    return await this.connection.close();
  }
}

const formatRe = /\bformat\b\s([a-z]*)$/i;
export function validateSelectQuery(query: string): void {
  if (formatRe.test(query)) {
    throw new Error(
      'Specifying format is not supported, use "format" parameter instead.'
    );
  }
}

function formatSelectQuery(query: string, format: DataFormat): string {
  query = query.trim();
  return query + ' FORMAT ' + format;
}

function validateInsertValues(
  values: ReadonlyArray<any> | Stream.Readable
): void {
  if (Array.isArray(values) === false && isStream(values) == false) {
    throw new Error(
      'Insert expected "values" to be an array or a stream of values.'
    );
  }

  if (isStream(values) && !values.readableObjectMode) {
    throw new Error('Insert expected Readable Stream in an object mode.');
  }
}

/**
 * A function encodes an array or a stream of JSON objects to a format compatible with ClickHouse.
 * If values are provided as an array of JSON objects, the function encodes it in place.
 * If values are provided as a stream of JSON objects, the function sets up the encoding of each chunk.
 *
 * @param values a set of values to send to ClickHouse.
 * @param format a format to encode value to.
 */
function encodeValues(
  values: ReadonlyArray<any> | Stream.Readable,
  format: DataFormat
): string | Stream.Readable {
  if (isStream(values)) {
    return values.pipe(
      mapStream(function (value: any) {
        return encode(value, format);
      })
    );
  }
  return values.map((value) => encode(value, format)).join('');
}

export function createClient(
  config?: ClickHouseClientConfigOptions
): ClickHouseClient {
  return new ClickHouseClient(config);
}
