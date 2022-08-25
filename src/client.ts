import Stream from 'stream'
import { type Connection, createConnection } from './connection'
import { Logger } from './logger'
import { isStream, mapStream } from './utils'
import { type DataFormat, encode, isSupportedRawFormat } from './data_formatter'
import { Rows } from './rows'
import type { ClickHouseSettings } from './settings'

export interface ClickHouseClientConfigOptions {
  host?: string
  connect_timeout?: number
  request_timeout?: number
  // max_open_connections?: number;

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

export interface SelectParams extends BaseParams {
  query: string
  format?: DataFormat
}

export interface CommandParams extends BaseParams {
  query: string
  /**
   * Use 'false' if your command does not support FORMAT statement,
   * and it needs to be omitted from the query
   */
  format?: DataFormat | false
}

export interface InsertParams extends BaseParams {
  table: string
  values: ReadonlyArray<any> | Stream.Readable
  format?: DataFormat
}

function validateConfig(config: NormalizedConfig): void {
  const host = config.host
  if (host.protocol !== 'http:' && host.protocol !== 'https:') {
    throw new Error(
      `Only http(s) protocol is supported, but given: [${host.protocol}]`
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
    host: createUrl(config.host ?? 'http://localhost:8123'),
    connect_timeout: config.connect_timeout ?? 10_000,
    request_timeout: config.request_timeout ?? 300_000,
    // max_open_connections: options.max_open_connections ?? 256,
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

  async select(params: SelectParams): Promise<Rows> {
    validateSelectQuery(params.query)
    const format = params.format ?? 'JSON'
    const query = formatSelectQuery(params.query, format)

    const stream = await this.connection.select({
      query,
      ...this.getBaseParams(params),
    })

    return new Rows(stream, format)
  }

  async command(params: CommandParams): Promise<Rows> {
    const format = params.format === undefined ? 'JSON' : params.format
    const query = formatCommandQuery(params.query, format)

    const stream = await this.connection.command({
      query,
      ...this.getBaseParams(params),
    })

    return new Rows(stream, format as any)
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

const formatRe = /\bformat\b\s([a-z]*)$/i
export function validateSelectQuery(query: string): void {
  if (formatRe.test(query)) {
    throw new Error(
      'Specifying format is not supported, use "format" parameter instead.'
    )
  }
}

function formatSelectQuery(query: string, format: DataFormat): string {
  query = query.trim()
  return query + ' \nFORMAT ' + format
}

function formatCommandQuery(query: string, format: DataFormat | false): string {
  query = query.trim()
  if (format !== false) {
    return query + ' \nFORMAT ' + format
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
 * If values are provided as a raw stream, the function only adds a listener for error events to log it.
 *
 * @param values a set of values to send to ClickHouse.
 * @param format a format to encode value to.
 */
function encodeValues(
  values: ReadonlyArray<any> | Stream.Readable,
  format: DataFormat
): string | Stream.Readable {
  if (isStream(values)) {
    if (!values.readableObjectMode) {
      values.addListener('error', pipelineCb)
      return values
    }
    return Stream.pipeline(
      values,
      mapStream((value) => encode(value, format)),
      pipelineCb
    )
  }
  return values.map((value) => encode(value, format)).join('')
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
