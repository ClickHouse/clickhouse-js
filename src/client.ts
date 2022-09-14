import Stream from 'stream'
import { type Connection, createConnection } from './connection'
import { Logger } from './logger'
import { isStream, mapStream } from './utils'
import {
  type DataFormat,
  encodeJSON,
  isSupportedRawFormat,
} from './data_formatter'
import { Rows } from './rows'
import type { ClickHouseSettings } from './settings'

export interface ClickHouseClientConfigOptions {
  host?: string
  connect_timeout?: number
  request_timeout?: number
  max_open_connections?: number

  compression?: {
    response?: boolean
    request?: boolean
  }
  // tls?: TlsOptions;

  username?: string
  password?: string

  application?: string
  database?: string
  clickhouse_settings?: ClickHouseSettings
  log?: {
    enable?: boolean
    LoggerClass?: new (enabled: boolean) => Logger
  }
}

export interface BaseParams {
  clickhouse_settings?: ClickHouseSettings
  query_params?: Record<string, unknown>
  abort_signal?: AbortSignal
}

export interface QueryParams extends BaseParams {
  query: string
  format?: DataFormat
}

export interface ExecParams extends BaseParams {
  query: string
}

export interface InsertParams extends BaseParams {
  table: string
  values: ReadonlyArray<any> | Stream.Readable
  format?: DataFormat
}

function validateConfig({ url }: NormalizedConfig): void {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Only http(s) protocol is supported, but given: [${url.protocol}]`
    )
  }
  // TODO add SSL validation
}

function createUrl(host: string): URL {
  try {
    return new URL(host)
  } catch (err) {
    throw new Error('Configuration parameter "host" contains malformed url.')
  }
}

function normalizeConfig(
  config: ClickHouseClientConfigOptions,
  loggingEnabled: boolean
) {
  return {
    url: createUrl(config.host ?? 'http://localhost:8123'),
    connect_timeout: config.connect_timeout ?? 10_000,
    request_timeout: config.request_timeout ?? 300_000,
    max_open_connections: config.max_open_connections ?? Infinity,
    // tls: _config.tls,
    compression: {
      decompress_response: config.compression?.response ?? true,
      compress_request: config.compression?.request ?? false,
    },
    username: config.username ?? 'default',
    password: config.password ?? '',
    application: config.application ?? 'clickhouse-js',
    database: config.database ?? 'default',
    clickhouse_settings: config.clickhouse_settings ?? {},
    log: {
      enable: loggingEnabled,
      LoggerClass: config.log?.LoggerClass ?? Logger,
    },
  }
}

type NormalizedConfig = ReturnType<typeof normalizeConfig>

export class ClickHouseClient {
  private readonly config: NormalizedConfig
  private readonly connection: Connection
  readonly logger: Logger

  constructor(config: ClickHouseClientConfigOptions = {}) {
    const loggingEnabled = Boolean(
      config.log?.enable || process.env.CLICKHOUSE_LOG_ENABLE
    )
    this.config = normalizeConfig(config, loggingEnabled)
    validateConfig(this.config)

    this.logger = new this.config.log.LoggerClass(this.config.log.enable)
    this.connection = createConnection(this.config, this.logger)
  }

  private getBaseParams(params: BaseParams) {
    return {
      clickhouse_settings: {
        ...this.config.clickhouse_settings,
        ...params.clickhouse_settings,
      },
      query_params: params.query_params,
      abort_signal: params.abort_signal,
    }
  }

  async query(params: QueryParams): Promise<Rows> {
    const format = params.format ?? 'JSON'
    const query = formatQuery(params.query, format)
    const stream = await this.connection.select({
      query,
      ...this.getBaseParams(params),
    })
    return new Rows(stream, format)
  }

  exec(params: ExecParams): Promise<Stream.Readable> {
    const query = removeSemi(params.query.trim())
    return this.connection.command({
      query,
      ...this.getBaseParams(params),
    })
  }

  async insert(params: InsertParams): Promise<void> {
    const format = params.format || 'JSONCompactEachRow'

    validateInsertValues(params.values, format)
    const query = `INSERT into ${params.table.trim()} FORMAT ${format}`

    await this.connection.insert({
      query,
      values: encodeValues(params.values, format),
      ...this.getBaseParams(params),
    })
  }

  async ping(): Promise<boolean> {
    return await this.connection.ping()
  }

  async close(): Promise<void> {
    return await this.connection.close()
  }
}

function formatQuery(query: string, format: DataFormat): string {
  query = query.trim()
  query = removeSemi(query)
  return query + ' \nFORMAT ' + format
}

function removeSemi(query: string) {
  const idx = query.indexOf(';')
  if (idx !== -1) {
    return query.slice(0, idx)
  }
  return query
}

export function validateInsertValues(
  values: ReadonlyArray<any> | Stream.Readable,
  format: DataFormat
): void {
  if (Array.isArray(values) === false && isStream(values) === false) {
    throw new Error(
      'Insert expected "values" to be an array or a stream of values.'
    )
  }

  if (isStream(values)) {
    if (isSupportedRawFormat(format)) {
      if (values.readableObjectMode) {
        throw new Error(
          `Insert for ${format} expected Readable Stream with disabled object mode.`
        )
      }
    } else if (!values.readableObjectMode) {
      throw new Error(
        `Insert for ${format} expected Readable Stream with enabled object mode.`
      )
    }
  }
}

/**
 * A function encodes an array or a stream of JSON objects to a format compatible with ClickHouse.
 * If values are provided as an array of JSON objects, the function encodes it in place.
 * If values are provided as a stream of JSON objects, the function sets up the encoding of each chunk.
 * If values are provided as a raw non-object stream, the function does nothing.
 *
 * @param values a set of values to send to ClickHouse.
 * @param format a format to encode value to.
 */
function encodeValues(
  values: ReadonlyArray<any> | Stream.Readable,
  format: DataFormat
): string | Stream.Readable {
  if (isStream(values)) {
    // TSV/CSV/CustomSeparated formats don't require additional serialization
    if (!values.readableObjectMode) {
      return values
    }
    // JSON* formats streams
    return Stream.pipeline(
      values,
      mapStream((value) => encodeJSON(value, format)),
      pipelineCb
    )
  }
  // JSON* arrays
  return values.map((value) => encodeJSON(value, format)).join('')
}

export function createClient(
  config?: ClickHouseClientConfigOptions
): ClickHouseClient {
  return new ClickHouseClient(config)
}

function pipelineCb(err: NodeJS.ErrnoException | null) {
  if (err) {
    console.error(err)
  }
}
