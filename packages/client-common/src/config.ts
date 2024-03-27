import type { InsertValues } from './client'
import type { Connection, ConnectionParams } from './connection'
import type { DataFormat } from './data_formatter'
import type { Logger } from './logger'
import { ClickHouseLogLevel, LogWriter } from './logger'
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
  /** @deprecated since version 1.0.0. Use {@link url} instead. <br/>
   *  A ClickHouse instance URL.
   *  @default http://localhost:8123 */
  host?: string
  /** A ClickHouse instance URL.
   *  @default http://localhost:8123 */
  url?: string | URL
  /** An optional pathname to add to the ClickHouse URL after it is parsed by the client.
   *  For example, if you use a proxy, and your ClickHouse instance can be accessed as http://proxy:8123/clickhouse_server,
   *  specify `clickhouse_server` here (with or without a leading slash);
   *  otherwise, if provided directly in the {@link url}, it will be considered as the `database` option.
   *  @default empty string */
  pathname?: string
  /** The request timeout in milliseconds.
   *  @default 30_000 */
  request_timeout?: number
  /** Maximum number of sockets to allow per host.
   *  @default 10 */
  max_open_connections?: number
  /** Request and response compression settings. Can't be enabled for a user with readonly=1. */
  compression?: {
    /** `response: true` instructs ClickHouse server to respond with
     *  compressed response body.
     *  @default true; if {@link readonly} is enabled, then false. */
    response?: boolean
    /** `request: true` enabled compression on the client request body.
     *  @default false. */
    request?: boolean
  }
  /** The name of the user on whose behalf requests are made.
   *  @default default */
  username?: string
  /** The user password.
   *  @default empty */
  password?: string
  /** The name of the application using the JS client.
   *  @default empty */
  application?: string
  /** Database name to use.
   * @default default */
  database?: string
  /** ClickHouse settings to apply to all requests.
   *  @default see {@link DefaultClickHouseSettings} */
  clickhouse_settings?: ClickHouseSettings
  log?: {
    /** A class to instantiate a custom logger implementation.
     *  @default see {@link DefaultLogger} */
    LoggerClass?: new () => Logger
    /** @default set to {@link ClickHouseLogLevel.OFF} */
    level?: ClickHouseLogLevel
  }
  /** ClickHouse Session id to attach to the outgoing requests.
   *  @default empty */
  session_id?: string
  /** @deprecated since version 1.0.0. Use {@link http_headers} instead. <br/>
   *  Additional HTTP headers to attach to the outgoing requests.
   *  @default empty */
  additional_headers?: Record<string, string>
  /** Additional HTTP headers to attach to the outgoing requests.
   *  @default empty */
  http_headers?: Record<string, string>
  /** If the client instance created for a user with `READONLY = 1` mode,
   *  some settings, such as {@link compression}, `send_progress_in_http_headers`,
   *  and `http_headers_progress_interval_ms` can't be modified,
   *  and will be removed from the client configuration.
   *  NB: this is not necessary if a user has `READONLY = 2` mode.
   *  @see https://clickhouse.com/docs/en/operations/settings/permissions-for-queries#readonly
   *  @default false */
  readonly?: boolean
  /** HTTP Keep-Alive related settings */
  keep_alive?: {
    /** Enable or disable HTTP Keep-Alive mechanism.
     *  @default true */
    enabled?: boolean
  }
}

export type MakeConnection<
  Stream,
  Config = BaseClickHouseClientConfigOptionsWithURL,
> = (config: Config, params: ConnectionParams) => Connection<Stream>

export type MakeResultSet<Stream> = <
  Format extends DataFormat,
  ResultSet extends BaseResultSet<Stream, Format>,
>(
  stream: Stream,
  format: Format,
  query_id: string,
) => ResultSet

export interface ValuesEncoder<Stream> {
  validateInsertValues<T = unknown>(
    values: InsertValues<Stream, T>,
    format: DataFormat,
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
    format: DataFormat,
  ): string | Stream
}

export type CloseStream<Stream> = (stream: Stream) => Promise<void>

/**
 * An implementation might have extra config parameters that we can parse from the connection URL.
 * These are supposed to be processed after we finish parsing the base configuration.
 * URL params handled in the common package will be deleted from the URL object.
 * This way we ensure that only implementation-specific params are passed there,
 * so we can indicate which URL parameters are unknown by both common and implementation packages.
 */
export type HandleImplSpecificURLParams = (
  config: BaseClickHouseClientConfigOptions,
  url: URL,
) => {
  config: BaseClickHouseClientConfigOptions
  // params that were handled in the implementation; used to calculate final "unknown" URL params
  // i.e. common package does not know about Node.js-specific ones,
  // but after handling we will be able to remove them from the final unknown set (and not throw).
  handled_params: Set<string>
  // params that are still unknown even in the implementation
  unknown_params: Set<string>
}

/** Things that may vary between Web/Node.js/etc client implementations. */
export interface ImplementationDetails<Stream> {
  impl: {
    make_connection: MakeConnection<Stream>
    make_result_set: MakeResultSet<Stream>
    values_encoder: ValuesEncoder<Stream>
    close_stream: CloseStream<Stream>
    handle_specific_url_params?: HandleImplSpecificURLParams
  }
}

// Configuration with parameters parsed from the URL, and the URL itself normalized for the connection.
export type BaseClickHouseClientConfigOptionsWithURL = Omit<
  BaseClickHouseClientConfigOptions,
  'url'
> & { url: URL } // not string and not undefined

/**
 * Validates and normalizes the provided "base" config.
 * Warns about deprecated configuration parameters usage.
 * Parses the common URL parameters into the configuration parameters (these are the same for all implementations).
 * Parses implementation-specific URL parameters using the handler provided by that implementation.
 * Merges these parameters with the base config and implementation-specific defaults.
 * Enforces certain defaults in case of deprecated keys or readonly mode.
 */
export function prepareConfigWithURL(
  baseConfigOptions: BaseClickHouseClientConfigOptions,
  logger: Logger,
  handleImplURLParams: HandleImplSpecificURLParams | null,
): BaseClickHouseClientConfigOptionsWithURL {
  const baseConfig = { ...baseConfigOptions }
  if (baseConfig.additional_headers !== undefined) {
    logger.warn({
      module: 'Config',
      message:
        '"additional_headers" is deprecated. Use "http_headers" instead.',
    })
    baseConfig.http_headers = baseConfig.additional_headers
    delete baseConfig.additional_headers
  }
  let configURL
  if (baseConfig.host !== undefined) {
    logger.warn({
      module: 'Config',
      message: '"host" is deprecated. Use "url" instead.',
    })
    configURL = createUrl(baseConfig.host)
    delete baseConfig.host
  } else {
    configURL = createUrl(baseConfig.url)
  }
  const [url, configFromURL] = loadConfigOptionsFromURL(
    configURL,
    handleImplURLParams,
  )
  const config = mergeConfigs(baseConfig, configFromURL, logger)
  let clickHouseSettings: ClickHouseSettings
  let compressionSettings: BaseClickHouseClientConfigOptions['compression']
  // TODO: maybe validate certain settings that cannot be modified with read-only user
  if (!config.readonly) {
    clickHouseSettings = {
      ...DefaultClickHouseSettings,
      ...config.clickhouse_settings,
    }
    compressionSettings = {
      response: config.compression?.response ?? true,
      request: config.compression?.request ?? false,
    }
  } else {
    clickHouseSettings = config.clickhouse_settings ?? {}
    for (const key of Object.keys(DefaultClickHouseSettings)) {
      if (clickHouseSettings[key] !== undefined) {
        logger.warn({
          module: 'Config',
          message: `ClickHouse setting ${key} is ignored when readonly mode is enabled.`,
        })
      }
      delete clickHouseSettings[key]
    }
    if (
      config.compression?.request === true ||
      config.compression?.response === true
    ) {
      logger.warn({
        module: 'Config',
        message:
          'Compression configuration is ignored when readonly mode is enabled.',
      })
    }
    compressionSettings = {
      response: false,
      request: false,
    }
  }
  if (config.pathname !== undefined) {
    url.pathname = config.pathname
  }
  config.url = url
  config.clickhouse_settings = clickHouseSettings
  config.compression = compressionSettings
  return config as BaseClickHouseClientConfigOptionsWithURL
}

export function getConnectionParams(
  config: BaseClickHouseClientConfigOptionsWithURL,
  logger: Logger,
): ConnectionParams {
  return {
    url: config.url,
    application_id: config.application,
    request_timeout: config.request_timeout ?? 30_000,
    max_open_connections: config.max_open_connections ?? Infinity,
    compression: {
      decompress_response: config.compression?.response ?? true,
      compress_request: config.compression?.request ?? false,
    },
    username: config.username ?? 'default',
    password: config.password ?? '',
    database: config.database ?? 'default',
    log_writer: new LogWriter(logger, 'Connection', config.log?.level),
    keep_alive: { enabled: config.keep_alive?.enabled ?? true },
    clickhouse_settings: config.clickhouse_settings ?? {},
    http_headers: config.http_headers ?? {},
  }
}

/**
 * Merge two versions of the config: base (hardcoded) from the instance creation and the URL parsed one.
 * URL config takes priority and overrides the base config parameters.
 * If a value is overridden, then a warning will be logged (even if the log level is OFF).
 */
export function mergeConfigs(
  baseConfig: BaseClickHouseClientConfigOptions,
  configFromURL: BaseClickHouseClientConfigOptions,
  logger: Logger,
): BaseClickHouseClientConfigOptions {
  function deepMerge(
    base: Record<string, any>,
    fromURL: Record<string, any>,
    path: string[] = [],
  ) {
    for (const key of Object.keys(fromURL)) {
      if (typeof fromURL[key] === 'object') {
        deepMerge(base, fromURL[key], path.concat(key))
      } else {
        let baseAtPath: Record<string, any> = base
        for (const key of path) {
          if (baseAtPath[key] === undefined) {
            baseAtPath[key] = {}
          }
          baseAtPath = baseAtPath[key]
        }
        const baseAtKey = baseAtPath[key]
        if (baseAtKey !== undefined) {
          const fullPath = path.concat(key).join('.')
          logger.warn({
            module: 'Config',
            message: `"${fullPath}" is overridden by a URL parameter.`,
          })
        }
        baseAtPath[key] = fromURL[key]
      }
    }
  }

  const config: Record<string, any> = { ...baseConfig }
  deepMerge(config, configFromURL)
  return config as BaseClickHouseClientConfigOptions
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
    throw new Error(
      'ClickHouse URL is malformed. Expected format: http[s]://[username:password@]hostname:port[/database][?param1=value1&param2=value2]',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `ClickHouse URL protocol must be either http or https. Got: ${url.protocol}`,
    )
  }
  if (url.port === '' || isNaN(Number(url.port))) {
    throw new Error('ClickHouse URL must contain a valid port number.')
  }
  return url
}

/**
 * @param url potentially contains auth, database and URL params to parse the configuration from
 * @param handleExtraURLParams some platform-specific URL params might be unknown by the common package;
 * use this function defined in the implementation to handle them. Logs warnings in case of hardcode overrides.
 */
export function loadConfigOptionsFromURL(
  url: URL,
  handleExtraURLParams: HandleImplSpecificURLParams | null,
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
  const urlSearchParamsKeys = [...url.searchParams.keys()]
  if (urlSearchParamsKeys.length > 0) {
    const unknownParams = new Set<string>()
    const settingPrefix = 'clickhouse_setting_'
    const settingShortPrefix = 'ch_'
    const httpHeaderPrefix = 'http_header_'
    urlSearchParamsKeys.forEach((key) => {
      let paramWasProcessed = true
      const value = url.searchParams.get(key) as string
      if (key.startsWith(settingPrefix)) {
        // clickhouse_settings_*
        const settingKey = key.slice(settingPrefix.length)
        if (config.clickhouse_settings === undefined) {
          config.clickhouse_settings = {}
        }
        config.clickhouse_settings[settingKey] = value
      } else if (key.startsWith(settingShortPrefix)) {
        // ch_*
        const settingKey = key.slice(settingShortPrefix.length)
        if (config.clickhouse_settings === undefined) {
          config.clickhouse_settings = {}
        }
        config.clickhouse_settings[settingKey] = value
      } else if (key.startsWith(httpHeaderPrefix)) {
        // http_headers_*
        const headerKey = key.slice(httpHeaderPrefix.length)
        if (config.http_headers === undefined) {
          config.http_headers = {}
        }
        config.http_headers[headerKey] = value
      } else {
        // static known parameters
        switch (key) {
          case 'readonly':
            config.readonly = booleanConfigURLValue({ key, value })
            break
          case 'application':
            config.application = value
            break
          case 'pathname':
            config.pathname = value
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
            paramWasProcessed = false
            unknownParams.add(key)
            break
        }
      }
      if (paramWasProcessed) {
        // so it won't be passed to the impl URL params handler
        url.searchParams.delete(key)
      }
    })
    if (handleExtraURLParams !== null) {
      const res = handleExtraURLParams(config, url)
      config = res.config
      if (unknownParams.size > 0) {
        res.handled_params.forEach((k) => unknownParams.delete(k))
      }
      if (res.unknown_params.size > 0) {
        res.unknown_params.forEach((k) => unknownParams.add(k))
      }
    }
    if (unknownParams.size > 0) {
      throw new Error(
        `Unknown URL parameters: ${Array.from(unknownParams).join(', ')}`,
      )
    }
  }
  // clean up the final ClickHouse URL to be used in the connection
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
  throw new Error(
    `"${key}" has invalid boolean value: ${trimmed}. Expected one of: 0, 1, true, false.`,
  )
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
    throw new Error(`"${key}" has invalid numeric value: ${trimmed}`)
  if (min !== undefined && number < min) {
    throw new Error(`"${key}" value ${trimmed} is less than min allowed ${min}`)
  }
  if (max !== undefined && number > max) {
    throw new Error(
      `"${key}" value ${trimmed} is greater than max allowed ${max}`,
    )
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
    [k in Key]: Enum
  }
}): Enum {
  const values = Object.keys(enumObject).filter((item) => isNaN(Number(item)))
  const trimmed = value.trim()
  if (!values.includes(trimmed)) {
    const expected = values.join(', ')
    throw new Error(
      `"${key}" has invalid value: ${trimmed}. Expected one of: ${expected}.`,
    )
  }
  return enumObject[trimmed as Key]
}
