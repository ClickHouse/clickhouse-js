import Stream from 'stream'
import type { ExecResult, InsertResult, TLSParams } from './connection'
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
  /** AbortController instance to cancel a request in progress. */
  abort_controller?: AbortController
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

export type CommandParams = ExecParams
export interface CommandResult {
  query_id: string
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
      abort_controller: params.abort_controller,
      session_id: this.config.session_id,
      query_id: params.query_id,
    }
  }

  /**
   * Used for most statements that can have a response, such as SELECT.
   * FORMAT clause should be specified separately via {@link QueryParams.format} (default is JSON)
   * Consider using {@link ClickHouseClient.insert} for data insertion,
   * or {@link ClickHouseClient.command} for DDLs.
   */
  async query(params: QueryParams): Promise<ResultSet> {
    const format = params.format ?? 'JSON'
    const query = formatQuery(params.query, format)
    const { stream, query_id } = await this.connection.query({
      query,
      ...this.getBaseParams(params),
    })
    return new ResultSet(stream, format, query_id)
  }

  /**
   * It should be used for statements that do not have any output,
   * when the format clause is not applicable, or when you are not interested in the response at all.
   * Response stream is destroyed immediately as we do not expect useful information there.
   * Examples of such statements are DDLs or custom inserts.
   * If you are interested in the response data, consider using {@link ClickHouseClient.exec}
   */
  async command(params: CommandParams): Promise<CommandResult> {
    const { stream, query_id } = await this.exec(params)
    stream.destroy()
    return { query_id }
  }

  /**
   * Similar to {@link ClickHouseClient.command}, but for the cases where the output is expected,
   * but format clause is not applicable. The caller of this method is expected to consume the stream,
   * otherwise, the request will eventually be timed out.
   */
  async exec(params: ExecParams): Promise<ExecResult> {
    const query = removeTrailingSemi(params.query.trim())
    return await this.connection.exec({
      query,
      ...this.getBaseParams(params),
    })
  }

  /**
   * The primary method for data insertion. It is recommended to avoid arrays in case of large inserts
   * to reduce application memory consumption and consider streaming for most of such use cases.
   * As the insert operation does not provide any output, the response stream is immediately destroyed.
   * In case of a custom insert operation, such as, for example, INSERT FROM SELECT,
   * consider using {@link ClickHouseClient.command}, passing the entire raw query there (including FORMAT clause).
   */
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

  /**
   * Health-check request. Can throw an error if the connection is refused.
   */
  async ping(): Promise<boolean> {
    return await this.connection.ping()
  }

  /**
   * Shuts down the underlying connection.
   * This method should ideally be called only once per application lifecycle,
   * for example, during the graceful shutdown phase.
   */
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
