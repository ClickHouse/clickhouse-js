import type { InsertValues } from './client'
import type {
  CompressionSettings,
  Connection,
  ConnectionParams,
} from './connection'
import type { DataFormat } from './data_formatter'
import type { Logger } from './logger'
import { ClickHouseLogLevel, DefaultLogger, LogWriter } from './logger'
import type { BaseResultSet } from './result'
import type { ClickHouseSettings } from './settings'

/**
 * By default, {@link send_progress_in_http_headers} is enabled, and {@link http_headers_progress_interval_ms} is set to 20s.
 * These settings in combination allow to avoid LB timeout issues in case of long-running queries without data coming in or out,
 * such as `INSERT FROM SELECT` and similar ones, as the connection could be marked as idle by the LB and closed abruptly.
 * 20s is chosen as a safe value, since most LBs will have at least 30s of idle timeout, and AWS LB sends KeepAlive packets every 20s.
 * It can be overridden when creating a client instance if your LB timeout value is even lower than that.
 * See also: https://docs.aws.amazon.com/elasticloadbalancing/latest/network/network-load-balancers.html#connection-idle-timeout
 */
const DefaultClickHouseSettings: ClickHouseSettings = {
  send_progress_in_http_headers: 1,
  http_headers_progress_interval_ms: '20000',
}

export interface BaseClickHouseClientConfigOptions {
  /** @deprecated since version 0.3.0. Use {@link url} instead. <br/>
   * A ClickHouse instance URL. Default value: `http://localhost:8123`. */
  host?: string
  /** A ClickHouse instance URL. Default value: `http://localhost:8123`. */
  url?: string | URL
  /** The request timeout in milliseconds. Default value: `30_000`. */
  request_timeout?: number
  /** Maximum number of sockets to allow per host. Default value: `Infinity`. */
  max_open_connections?: number

  compression?: {
    /** `response: true` instructs ClickHouse server to respond with
     * compressed response body. Default: true; if {@link readonly} is enabled, then false. */
    response?: boolean
    /** `request: true` enabled compression on the client request body.
     * Default: false. */
    request?: boolean
  }
  /** The name of the user on whose behalf requests are made.
   * Default: 'default'. */
  username?: string
  /** The user password. Default: ''. */
  password?: string
  /** The name of the application using the JS client.
   * Default: empty. */
  application?: string
  /** Database name to use. Default value: `default`. */
  database?: string
  /** ClickHouse settings to apply to all requests.
   * Default value: {@link DefaultClickHouseSettings}
   */
  clickhouse_settings?: ClickHouseSettings
  log?: {
    /** A class to instantiate a custom logger implementation.
     * Default: {@link DefaultLogger} */
    LoggerClass?: new () => Logger
    /** Default: OFF */
    level?: ClickHouseLogLevel
  }
  /** ClickHouse Session id to attach to the outgoing requests.
   * Default: empty. */
  session_id?: string
  /** Additional HTTP headers to attach to the outgoing requests.
   * Default: empty. */
  additional_headers?: Record<string, string>
  /** If the client instance created for a user with `READONLY = 1` mode,
   * some settings, such as {@link compression}, `send_progress_in_http_headers`,
   * and `http_headers_progress_interval_ms` can't be modified,
   * and will be removed from the client configuration.
   * NB: this is not necessary if a user has `READONLY = 2` mode.
   * See also: https://clickhouse.com/docs/en/operations/settings/permissions-for-queries#readonly
   * Default: false */
  readonly?: boolean
  /** HTTP Keep-Alive related settings */
  keep_alive?: {
    /** Enable or disable HTTP Keep-Alive mechanism. Default: true */
    enabled?: boolean
  }
}

export type MakeConnection<Stream> = (
  params: ConnectionParams
) => Connection<Stream>

export type MakeResultSet<Stream> = (
  stream: Stream,
  format: DataFormat,
  session_id: string
) => BaseResultSet<Stream>

export interface ValuesEncoder<Stream> {
  validateInsertValues<T = unknown>(
    values: InsertValues<Stream, T>,
    format: DataFormat
  ): void

  /**
   * A function encodes an array or a stream of JSON objects to a format compatible with ClickHouse.
   * If values are provided as an array of JSON objects, the function encodes it in place.
   * If values are provided as a stream of JSON objects, the function sets up the encoding of each chunk.
   * If values are provided as a raw non-object stream, the function does nothing.
   *
   * @param values a set of values to send to ClickHouse.
   * @param format a format to encode value to.
   */
  encodeValues<T = unknown>(
    values: InsertValues<Stream, T>,
    format: DataFormat
  ): string | Stream
}

export type CloseStream<Stream> = (stream: Stream) => Promise<void>

/**
 * An implementation might have extra config parameters that we can parse from the connection URL.
 * These are supposed to be processed after we finish parsing the base configuration.
 */
export type HandleExtraURLParams = (
  config: BaseClickHouseClientConfigOptions,
  url: URL
) => {
  config: BaseClickHouseClientConfigOptions
  handled_params: Set<string>
  unknown_params: Set<string>
}

/** Things that may vary between Web/Node.js/etc client implementations. */
interface ImplementationDetails<Stream> {
  impl: {
    make_connection: MakeConnection<Stream>
    make_result_set: MakeResultSet<Stream>
    values_encoder: ValuesEncoder<Stream>
    close_stream: CloseStream<Stream>
    handle_extra_url_params?: HandleExtraURLParams
  }
}

export type ClickHouseClientConfigOptions<Stream> =
  BaseClickHouseClientConfigOptions & ImplementationDetails<Stream>

export function getConnectionParams(
  baseConfig: BaseClickHouseClientConfigOptions,
  handleExtraURLParams: HandleExtraURLParams | null
): ConnectionParams {
  const logger = baseConfig?.log?.LoggerClass
    ? new baseConfig.log.LoggerClass()
    : new DefaultLogger()
  let configURL
  if (baseConfig.host !== undefined) {
    logger.warn({
      module: 'Config',
      message:
        'Configuration parameter "host" is deprecated. Use "url" instead.',
    })
    configURL = createUrl(baseConfig.host)
  } else {
    configURL = createUrl(baseConfig.url)
  }
  const [url, configFromURL] = loadConfigOptionsFromURL(
    configURL,
    handleExtraURLParams
  )
  const config = mergeConfigs(baseConfig, configFromURL, logger)

  let clickHouseSettings: ClickHouseSettings
  let compressionSettings: CompressionSettings
  // TODO: maybe validate certain settings that cannot be modified with read-only user
  if (!config.readonly) {
    clickHouseSettings = {
      ...DefaultClickHouseSettings,
      ...config.clickhouse_settings,
    }
    compressionSettings = {
      decompress_response: config.compression?.response ?? true,
      compress_request: config.compression?.request ?? false,
    }
  } else {
    clickHouseSettings = config.clickhouse_settings ?? {}
    compressionSettings = {
      decompress_response: false,
      compress_request: false,
    }
  }
  return {
    url,
    application_id: config.application,
    request_timeout: config.request_timeout ?? 300_000,
    max_open_connections: config.max_open_connections ?? Infinity,
    compression: compressionSettings,
    username: config.username ?? 'default',
    password: config.password ?? '',
    database: config.database ?? 'default',
    clickhouse_settings: clickHouseSettings,
    log_writer: new LogWriter(logger, config.log?.level),
    additional_headers: config.additional_headers,
  }
}

export function mergeConfigs(
  baseConfig: BaseClickHouseClientConfigOptions,
  configFromURL: BaseClickHouseClientConfigOptions,
  logger: Logger
): BaseClickHouseClientConfigOptions {
  const config = { ...baseConfig }
  const keys = Object.keys(
    configFromURL
  ) as (keyof BaseClickHouseClientConfigOptions)[]
  for (const key of keys) {
    if (config[key] !== undefined) {
      logger.warn({
        module: 'Config',
        message: `Configuration parameter ${key} is overridden by URL parameter.`,
      })
    }
    config[key] = configFromURL[key] as any
  }
  return config
}

export function createUrl(configURL: string | URL | undefined): URL {
  let url: URL
  try {
    if (typeof configURL === 'string' || configURL instanceof URL) {
      url = new URL(configURL)
    } else {
      return new URL('http://localhost:8123')
    }
  } catch (err) {
    throw new Error('Client URL is malformed.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Only http(s) protocol is supported, but given: [${url.protocol}]`
    )
  }
  return url
}

export function loadConfigOptionsFromURL(
  url: URL,
  handleExtraURLParams: HandleExtraURLParams | null
): [URL, BaseClickHouseClientConfigOptions] {
  let config: BaseClickHouseClientConfigOptions = {}
  if (url.username.trim() !== '') {
    config.username = url.username
  }
  // no trim for password
  if (url.password !== '') {
    config.password = url.password
  }
  if (url.pathname.trim().length > 1) {
    config.database = url.pathname.slice(1)
  }
  if (url.searchParams.size > 0) {
    const unknownParams = new Set<string>()
    const settingsPrefix = 'clickhouse_settings_'
    const additionalHeadersPrefix = 'additional_headers_'
    for (const key of url.searchParams.keys()) {
      const value = url.searchParams.get(key) as string
      // clickhouse_settings_*
      if (key.startsWith(settingsPrefix)) {
        const settingKey = key.slice(settingsPrefix.length)
        if (config.clickhouse_settings === undefined) {
          config.clickhouse_settings = {}
        }
        config.clickhouse_settings[settingKey] = value
      } else if (key.startsWith(additionalHeadersPrefix)) {
        const headerKey = key.slice(additionalHeadersPrefix.length)
        if (config.additional_headers === undefined) {
          config.additional_headers = {}
        }
        config.additional_headers[headerKey] = value
      } else {
        switch (key) {
          case 'readonly':
            config.readonly = booleanConfigURLValue({ key, value })
            break
          case 'application':
            config.application = value
            break
          case 'session_id':
            config.session_id = value
            break
          case 'request_timeout':
            config.request_timeout = numberConfigURLValue({
              key,
              value,
              min: 0,
            })
            break
          case 'max_open_connections':
            config.max_open_connections = numberConfigURLValue({
              key,
              value,
              min: 1,
            })
            break
          case 'compression_request':
            if (config.compression === undefined) {
              config.compression = {}
            }
            config.compression.request = booleanConfigURLValue({ key, value })
            break
          case 'compression_response':
            if (config.compression === undefined) {
              config.compression = {}
            }
            config.compression.response = booleanConfigURLValue({
              key,
              value,
            })
            break
          case 'log_level':
            if (config.log === undefined) {
              config.log = {}
            }
            config.log.level = enumConfigURLValue({
              key,
              value,
              enumObject: ClickHouseLogLevel,
            })
            break
          case 'keep_alive_enabled':
            if (config.keep_alive === undefined) {
              config.keep_alive = {}
            }
            config.keep_alive.enabled = booleanConfigURLValue({ key, value })
            break
          default:
            unknownParams.add(key)
        }
      }
      url.searchParams.delete(key)
    }
    if (handleExtraURLParams !== null) {
      const res = handleExtraURLParams(config, url)
      config = res.config
      res.handled_params.forEach((k) => unknownParams.delete(k))
    }
    if (unknownParams.size > 0) {
      throw new Error(
        `Unknown URL parameters: ${Array.from(unknownParams).join(', ')}`
      )
    }
  }
  const clickHouseURL = new URL(`${url.protocol}//${url.host}`)
  return [clickHouseURL, config]
}

export function booleanConfigURLValue({
  key,
  value,
}: {
  key: string
  value: string
}): boolean {
  const trimmed = value.trim()
  if (trimmed === 'true' || trimmed === '1') return true
  if (trimmed === 'false' || trimmed === '0') return false
  throw new Error(`${key} has invalid boolean value: ${trimmed}`)
}

export function numberConfigURLValue({
  key,
  value,
  min,
  max,
}: {
  key: string
  value: string
  min?: number
  max?: number
}): number {
  const trimmed = value.trim()
  const number = Number(trimmed)
  if (isNaN(number))
    throw new Error(`${key} has invalid number value: ${trimmed}`)
  if (min !== undefined && number < min) {
    throw new Error(`${key} value is less than minimum: ${trimmed}`)
  }
  if (max !== undefined && number > max) {
    throw new Error(`${key} value is greater than maximum: ${trimmed}`)
  }
  return number
}

export function enumConfigURLValue<Enum, Key extends string>({
  key,
  value,
  enumObject,
}: {
  key: string
  value: string
  enumObject: {
    [key in Key]: Enum
  }
}): Enum {
  const values = Object.keys(enumObject).filter((item) => isNaN(Number(item)))
  const trimmed = value.trim()
  if (!values.includes(trimmed)) {
    throw new Error(`${key} has invalid value: ${trimmed}`)
  }
  return enumObject[trimmed as Key]
}
