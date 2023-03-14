import Stream from 'stream'
import type { InsertResult, QueryResult, TLSParams } from './connection'
import { type Connection, createConnection } from './connection'
import type { Logger } from './logger'
import { DefaultLogger, LogWriter } from './logger'
import { isStream, mapStream } from './utils'
import {
  type DataFormat,
  encodeJSON,
  isSupportedRawFormat,
} from './data_formatter'
import { ResultSet } from './result'
import type { ClickHouseSettings } from './settings'
import type { InputJSON, InputJSONObjectEachRow } from './clickhouse_types'

export interface ClickHouseClientConfigOptions {
  /** A ClickHouse instance URL. Default value: `http://localhost:8123`. */
  host?: string
  /** The timeout to set up a connection in milliseconds. Default value: `10_000`. */
  connect_timeout?: number
  /** The request timeout in milliseconds. Default value: `30_000`. */
  request_timeout?: number
  /** Maximum number of sockets to allow per host. Default value: `Infinity`. */
  max_open_connections?: number

  compression?: {
    /** `response: true` instructs ClickHouse server to respond with compressed response body. Default: true. */
    response?: boolean
    /** `request: true` enabled compression on the client request body. Default: false. */
    request?: boolean
  }
  /** The name of the user on whose behalf requests are made. Default: 'default'. */
  username?: string
  /** The user password. Default: ''. */
  password?: string
  /** The name of the application using the nodejs client. Default: empty. */
  application?: string
  /** Database name to use. Default value: `default`. */
  database?: string
  /** ClickHouse settings to apply to all requests. Default value: {} */
  clickhouse_settings?: ClickHouseSettings
  log?: {
    /** A class to instantiate a custom logger implementation. */
    LoggerClass?: new () => Logger
  }
  tls?: BasicTLSOptions | MutualTLSOptions
  session_id?: string
}

interface BasicTLSOptions {
  ca_cert: Buffer
}

interface MutualTLSOptions {
  ca_cert: Buffer
  cert: Buffer
  key: Buffer
}

export interface BaseParams {
  /** ClickHouse settings that can be applied on query level. */
  clickhouse_settings?: ClickHouseSettings
  /** Parameters for query binding. https://clickhouse.com/docs/en/interfaces/http/#cli-queries-with-parameters */
  query_params?: Record<string, unknown>
  /** AbortSignal instance (using `node-abort-controller` package) to cancel a request in progress. */
  abort_signal?: AbortSignal
  /** A specific `query_id` that will be sent with this request.
   * If it is not set, a random identifier will be generated automatically by the client. */
  query_id?: string
}

export interface QueryParams extends BaseParams {
  /** Statement to execute. */
  query: string
  /** Format of the resulting dataset. */
  format?: DataFormat
}

export interface ExecParams extends BaseParams {
  /** Statement to execute. */
  query: string
}

type InsertValues<T> =
  | ReadonlyArray<T>
  | Stream.Readable
  | InputJSON<T>
  | InputJSONObjectEachRow<T>

export interface InsertParams<T = unknown> extends BaseParams {
  /** Name of a table to insert into. */
  table: string
  /** A dataset to insert. */
  values: InsertValues<T>
  /** Format of the dataset to insert. */
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

function normalizeConfig(config: ClickHouseClientConfigOptions) {
  let tls: TLSParams | undefined = undefined
  if (config.tls) {
    if ('cert' in config.tls && 'key' in config.tls) {
      tls = {
        type: 'Mutual',
        ...config.tls,
      }
    } else {
      tls = {
        type: 'Basic',
        ...config.tls,
      }
    }
  }
  return {
    application_id: config.application,
    url: createUrl(config.host ?? 'http://localhost:8123'),
    connect_timeout: config.connect_timeout ?? 10_000,
    request_timeout: config.request_timeout ?? 300_000,
    max_open_connections: config.max_open_connections ?? Infinity,
    tls,
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
      LoggerClass: config.log?.LoggerClass ?? DefaultLogger,
    },
    session_id: config.session_id,
  }
}

type NormalizedConfig = ReturnType<typeof normalizeConfig>

export class ClickHouseClient {
  private readonly config: NormalizedConfig
  private readonly connection: Connection
  private readonly logger: LogWriter

  constructor(config: ClickHouseClientConfigOptions = {}) {
    this.config = normalizeConfig(config)
    validateConfig(this.config)

    this.logger = new LogWriter(new this.config.log.LoggerClass())
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
      session_id: this.config.session_id,
      query_id: params.query_id,
    }
  }

  async query(params: QueryParams): Promise<ResultSet> {
    const format = params.format ?? 'JSON'
    const query = formatQuery(params.query, format)
    const { stream, query_id } = await this.connection.query({
      query,
      ...this.getBaseParams(params),
    })
    return new ResultSet(stream, format, query_id)
  }

  async exec(params: ExecParams): Promise<QueryResult> {
    const query = removeTrailingSemi(params.query.trim())
    return await this.connection.exec({
      query,
      ...this.getBaseParams(params),
    })
  }

  async insert<T>(params: InsertParams<T>): Promise<InsertResult> {
    const format = params.format || 'JSONCompactEachRow'

    validateInsertValues(params.values, format)
    const query = `INSERT INTO ${params.table.trim()} FORMAT ${format}`

    return await this.connection.insert({
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
  query = removeTrailingSemi(query)
  return query + ' \nFORMAT ' + format
}

function removeTrailingSemi(query: string) {
  let lastNonSemiIdx = query.length
  for (let i = lastNonSemiIdx; i > 0; i--) {
    if (query[i - 1] !== ';') {
      lastNonSemiIdx = i
      break
    }
  }
  if (lastNonSemiIdx !== query.length) {
    return query.slice(0, lastNonSemiIdx)
  }
  return query
}

export function validateInsertValues<T>(
  values: InsertValues<T>,
  format: DataFormat
): void {
  if (
    !Array.isArray(values) &&
    !isStream(values) &&
    typeof values !== 'object'
  ) {
    throw new Error(
      'Insert expected "values" to be an array, a stream of values or a JSON object, ' +
        `got: ${typeof values}`
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
export function encodeValues<T>(
  values: InsertValues<T>,
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
  if (Array.isArray(values)) {
    return values.map((value) => encodeJSON(value, format)).join('')
  }
  // JSON & JSONObjectEachRow format input
  if (typeof values === 'object') {
    return encodeJSON(values, format)
  }
  throw new Error(
    `Cannot encode values of type ${typeof values} with ${format} format`
  )
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
