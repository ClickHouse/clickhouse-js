import type { InsertValues, ResponseHeaders } from "./clickhouse_types";
import type {
  CompressionMethod,
  Connection,
  ConnectionParams,
  RequestCompression,
  ResponseCompression,
} from "./connection";
import type { DataFormat } from "./data_formatter";
import type { Logger } from "./logger";
import { ClickHouseLogLevel, LogWriter } from "./logger";
import { defaultJSONHandling, type JSONHandling } from "./parse/json_handling";
import type { BaseResultSet } from "./result";
import type { ClickHouseSettings } from "./settings";
import type { ClickHouseSpan, ClickHouseTracer } from "./tracing";

/** Normalizes the public request compression option into the internal codec
 *  object, or `undefined` when disabled. `true` keeps gzip for backwards
 *  compatibility; the object form (carrying its per-codec option) is passed
 *  through verbatim, so untyped JS supplying an unknown codec still reaches the
 *  Node guard, which rejects it with a clear error. */
function normalizeRequestCompression(
  value: boolean | RequestCompression | undefined,
): RequestCompression | undefined {
  if (!value) {
    return undefined;
  }
  if (value === true) {
    return { codec: "gzip" };
  }
  return value;
}

/** Normalizes the public response compression option
 *  (`false | true | { codec }`) into the internal codec object, or `undefined`
 *  when disabled. `true` keeps gzip for backwards compatibility. */
function normalizeResponseCompression(
  value: boolean | { codec: CompressionMethod } | undefined,
): ResponseCompression | undefined {
  if (!value) {
    return undefined;
  }
  if (value === true) {
    return { codec: "gzip" };
  }
  return { codec: value.codec };
}

export interface BaseClickHouseClientConfigOptions {
  /** @deprecated since version 1.0.0. Use {@link url} instead. <br/>
   *  A ClickHouse instance URL.
   *  @default http://localhost:8123 */
  host?: string;
  /** A ClickHouse instance URL.
   *  @default http://localhost:8123 */
  url?: string | URL;
  /** An optional pathname to add to the ClickHouse URL after it is parsed by the client.
   *  For example, if you use a proxy, and your ClickHouse instance can be accessed as http://proxy:8123/clickhouse_server,
   *  specify `clickhouse_server` here (with or without a leading slash);
   *  otherwise, if provided directly in the {@link url}, it will be considered as the `database` option.<br/>
   *  Multiple segments are supported, e.g. `/my_proxy/db`.
   *  @default empty string */
  pathname?: string;
  /** The request timeout in milliseconds.
   *  @default 30_000 */
  request_timeout?: number;
  /** Maximum number of sockets to allow per host.
   *  @default 10 */
  max_open_connections?: number;
  /** Request and response compression settings. */
  compression?: {
    /** Instructs the ClickHouse server to respond with a compressed response body.
     *  `true` requests `gzip`; pass `{ codec }` to select the codec explicitly,
     *  e.g. `{ codec: "zstd" }` or `{ codec: "br" }`. This adds the matching
     *  `Accept-Encoding` header and the `enable_http_compression=1` ClickHouse HTTP
     *  setting. Decompression takes no codec options (the server chose them).
     *  `"zstd"` requires Node.js >= 22.15.0; `"br"` works on any supported Node.js.
     *  On `@clickhouse/client-web`, `zstd` is rejected at client creation; `gzip`
     *  and `br` responses are decompressed by the browser.
     *  <p><b>Warning</b>: Response compression can't be enabled for a user with readonly=1, as ClickHouse will not allow settings modifications for such user.</p>
     *  @default false */
    response?: boolean | { codec: CompressionMethod };
    /** Enables compression of the outgoing request (insert) body.
     *  `true` uses `gzip` with defaults; pass a per-codec object to select the
     *  codec and tune it: `{ codec: "gzip", level }`, `{ codec: "zstd", level }`,
     *  or `{ codec: "br", quality }`. Each codec exposes its own option (a `level`
     *  for gzip/zstd, a `quality` for Brotli); when omitted, a sensible default is
     *  used (gzip/zstd use zlib's defaults, `br` defaults to quality 4 since
     *  zlib's brotli default of 11 is far too slow for a streaming insert body).
     *  `"zstd"` requires Node.js >= 22.15.0; `"br"` works on any supported Node.js.
     *  Request-body compression is performed only by `@clickhouse/client` (Node.js);
     *  `@clickhouse/client-web` sends request bodies uncompressed.
     *  @default false */
    request?: boolean | RequestCompression;
  };
  /** The name of the user on whose behalf requests are made.
   *  Should not be set if {@link access_token} is provided.
   *  @default default */
  username?: string;
  /** The user password.
   *  Should not be set if {@link access_token} is provided.
   *  @default empty string */
  password?: string;
  /** A JWT access token to authenticate with ClickHouse.
   *  JWT token authentication is supported in ClickHouse Cloud only.
   *  Should not be set if {@link username} or {@link password} are provided.
   *  @default empty */
  access_token?: string;
  /** The name of the application using the JS client.
   *  @default empty string */
  application?: string;
  /**
   * DANGEROUS: when enabled, the raw SQL query text is attached to tracing
   * spans as the OpenTelemetry `db.query.text` attribute and included in the
   * `error`-level logs emitted when a request fails.
   *
   * The query text may contain sensitive data inlined as literals (PII,
   * secrets, etc.), which is why this is off by default. Note that bound
   * {@link BaseQueryParams.query_params} values and credentials are **never**
   * logged or traced, regardless of this setting.
   *
   * Only enable this if your tracing/logging backend is trusted and you
   * understand the implications of persisting query text there.
   *
   * @default false
   */
  dangerously_log_query_text?: boolean;
  /** Database name to use.
   * @default default */
  database?: string;
  /** ClickHouse settings to apply to all requests.
   *  @default empty object */
  clickhouse_settings?: ClickHouseSettings;
  log?: {
    /** A class to instantiate a custom logger implementation.
     *  @default see {@link DefaultLogger} */
    LoggerClass?: new () => Logger;
    /** @default set to {@link ClickHouseLogLevel.WARN} */
    level?: ClickHouseLogLevel;
  };
  /** ClickHouse Session id to attach to the outgoing requests.
   *  @default empty string (no session) */
  session_id?: string;
  /** ClickHouse role name(s) to attach to the outgoing requests.
   *  @default undefined string (no roles) */
  role?: string | Array<string>;
  /** @deprecated since version 1.0.0. Use {@link http_headers} instead. <br/>
   *  Additional HTTP headers to attach to the outgoing requests.
   *  @default empty object */
  additional_headers?: Record<string, string>;
  /** Additional HTTP headers to attach to the outgoing requests.
   *  @default empty object */
  http_headers?: Record<string, string>;
  /** HTTP Keep-Alive related settings. */
  keep_alive?: {
    /** Enable or disable HTTP Keep-Alive mechanism.
     *  @default true */
    enabled?: boolean;
  };
  /**
   * Custom parsing when handling with JSON objects
   *
   * Defaults to using standard `JSON.parse` and `JSON.stringify`
   */
  json?: Partial<JSONHandling>;
  /**
   * Optional tracer called by the client around key lifecycle operations
   * (`query` / `command` / `exec` / `insert` / `ping`). The interface is a
   * structural subset of the OpenTelemetry `Tracer`/`Span` APIs, so a raw
   * OTEL tracer (`trace.getTracer(...)`) can be passed here as-is - but the
   * client itself depends on no tracing library.
   *
   * Each operation runs inside `tracer.startActiveSpan(name, options, fn)`.
   * For OpenTelemetry, active-span context propagation across the operation's
   * `await` points requires the `AsyncLocalStorageContextManager` (from
   * `@opentelemetry/context-async-hooks`) to be registered; this is the
   * default context manager in the OpenTelemetry Node.js SDK.
   *
   * Tracer calls are inlined into the client's hot path with no defensive
   * wrapper: exceptions thrown by the tracer or its spans propagate to the
   * caller. Make sure your tracer doesn't throw.
   *
   * @see {@link ClickHouseTracer}
   * @default undefined (no spans are emitted; the client uses a shared no-op tracer/span to keep call sites monomorphic,
   * at the cost of a small fixed per-operation overhead)
   */
  tracer?: ClickHouseTracer;
  /** When true, query() sends query_params as multipart/form-data parts
   *  instead of URL query string entries. This avoids HTTP URL length limits
   *  when query parameters contain large arrays (25K+ values).
   *  The SQL query is also moved into a multipart part named "query".
   *  All other URL search params (database, query_id, settings, etc.) remain in the URL.
   *  @default false */
  use_multipart_params?: boolean;
  /** When true, query() automatically sends query_params as multipart/form-data
   *  parts (see {@link use_multipart_params}) once their URL-encoded length
   *  exceeds a threshold (4096 characters), avoiding HTTP 414/400 errors from
   *  over-long URLs. Smaller parameter payloads remain in the URL query string.
   *  Has no effect when {@link use_multipart_params} is enabled, as that always
   *  sends the parameters as multipart/form-data parts.
   *  @default false */
  use_multipart_params_auto?: boolean;
}

export type MakeConnection<
  Stream,
  Config = BaseClickHouseClientConfigOptionsWithURL,
> = (config: Config, params: ConnectionParams) => Connection<Stream>;

export type MakeResultSet<Stream> = <
  Format extends DataFormat,
  ResultSet extends BaseResultSet<Stream, Format>,
>(
  stream: Stream,
  format: Format,
  query_id: string,
  log_error: (err: Error) => void,
  response_headers: ResponseHeaders,
  jsonHandling: JSONHandling,
  /** When the client was configured with a {@link ClickHouseTracer}, a
   *  `clickhouse.query.stream` child span is created and passed here.  The
   *  result set tracks its own streaming progress (decoded bytes/rows) and
   *  must record the final response metrics on the span and end it when the
   *  stream is fully consumed, closed, or fails. */
  span?: ClickHouseSpan,
) => ResultSet;

export type MakeValuesEncoder<Stream> = (
  jsonHandling: JSONHandling,
) => ValuesEncoder<Stream>;

export interface ValuesEncoder<Stream> {
  validateInsertValues<T = unknown>(
    values: InsertValues<Stream, T>,
    format: DataFormat,
  ): void;

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
  ): string | Stream;
}

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
  config: BaseClickHouseClientConfigOptions;
  // params that were handled in the implementation; used to calculate final "unknown" URL params
  // i.e. common package does not know about Node.js-specific ones,
  // but after handling we will be able to remove them from the final unknown set (and not throw).
  handled_params: Set<string>;
  // params that are still unknown even in the implementation
  unknown_params: Set<string>;
};

/** Things that may vary between Web/Node.js/etc client implementations. */
export interface ImplementationDetails<Stream> {
  impl: {
    make_connection: MakeConnection<Stream>;
    make_result_set: MakeResultSet<Stream>;
    values_encoder: MakeValuesEncoder<Stream>;
    handle_specific_url_params?: HandleImplSpecificURLParams;
  };
}

// Configuration with parameters parsed from the URL, and the URL itself normalized for the connection.
export type BaseClickHouseClientConfigOptionsWithURL = Omit<
  BaseClickHouseClientConfigOptions,
  "url"
> & { url: URL }; // not string and not undefined

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
  const baseConfig = { ...baseConfigOptions };
  if (baseConfig.additional_headers !== undefined) {
    logger.warn({
      module: "Config",
      message:
        '"additional_headers" is deprecated. Use "http_headers" instead.',
    });
    baseConfig.http_headers = baseConfig.additional_headers;
    delete baseConfig.additional_headers;
  }
  let configURL;
  if (baseConfig.host !== undefined) {
    logger.warn({
      module: "Config",
      message: '"host" is deprecated. Use "url" instead.',
    });
    configURL = createUrl(baseConfig.host);
    delete baseConfig.host;
  } else {
    configURL = createUrl(baseConfig.url);
  }
  const [url, configFromURL] = loadConfigOptionsFromURL(
    configURL,
    handleImplURLParams,
  );
  const config = mergeConfigs(baseConfig, configFromURL, logger);
  if (config.pathname !== undefined) {
    url.pathname = config.pathname;
  }
  config.url = url;
  return config as BaseClickHouseClientConfigOptionsWithURL;
}

export function getConnectionParams(
  config: BaseClickHouseClientConfigOptionsWithURL,
  logger: Logger,
): ConnectionParams {
  let auth: ConnectionParams["auth"];
  if (config.access_token !== undefined) {
    if (config.username !== undefined || config.password !== undefined) {
      throw new Error(
        "Both access token and username/password are provided in the configuration. Please use only one authentication method.",
      );
    }
    auth = { access_token: config.access_token, type: "JWT" };
  } else {
    auth = {
      username: config.username ?? "default",
      password: config.password ?? "",
      type: "Credentials",
    };
  }

  const log_level = config.log?.level ?? ClickHouseLogLevel.WARN;
  const request_timeout = config.request_timeout ?? 30_000;
  const clickhouse_settings = config.clickhouse_settings ?? {};

  if (log_level <= ClickHouseLogLevel.WARN) {
    // Warn if request_timeout is high but progress headers are not configured
    // This can lead to socket hang-up errors when long-running queries exceed load balancer idle timeouts
    const THRESHOLD_MS = 60_000; // 60 seconds
    if (request_timeout > THRESHOLD_MS) {
      const send_progress =
        String(clickhouse_settings.send_progress_in_http_headers) === "1";
      const progress_interval =
        clickhouse_settings.http_headers_progress_interval_ms;

      if (!send_progress) {
        logger.warn({
          module: "Config",
          message: `request_timeout is set to ${request_timeout}ms, but send_progress_in_http_headers is not enabled. Long-running queries may fail with socket hang-up errors if they exceed the load balancer idle timeout. Consider enabling progress headers with clickhouse_settings: { send_progress_in_http_headers: 1, http_headers_progress_interval_ms: '<interval>' }. See https://github.com/ClickHouse/clickhouse-js/blob/main/docs/howto/long_running_queries.md for more details.`,
        });
      } else if (progress_interval === undefined) {
        logger.warn({
          module: "Config",
          message: `request_timeout is set to ${request_timeout}ms and send_progress_in_http_headers is enabled, but http_headers_progress_interval_ms is not set. It is recommended to set http_headers_progress_interval_ms to a value slightly below your load balancer's idle timeout (e.g., '110000' for a 120s LB timeout). See https://github.com/ClickHouse/clickhouse-js/blob/main/docs/howto/long_running_queries.md for more details.`,
        });
      }
    }
  }

  return {
    auth,
    url: config.url,
    application_id: config.application,
    request_timeout,
    max_open_connections: config.max_open_connections ?? 10,
    compression: {
      decompress_response: normalizeResponseCompression(
        config.compression?.response,
      ),
      compress_request: normalizeRequestCompression(
        config.compression?.request,
      ),
    },
    database: config.database ?? "default",
    log_writer: new LogWriter(logger, "Connection", log_level),
    log_level: log_level,
    keep_alive: { enabled: config.keep_alive?.enabled ?? true },
    clickhouse_settings,
    http_headers: config.http_headers ?? {},
    json: {
      ...defaultJSONHandling,
      ...config.json,
    },
    ...(config.use_multipart_params ? { use_multipart_params: true } : {}),
    ...(config.use_multipart_params_auto
      ? { use_multipart_params_auto: true }
      : {}),
    ...(config.dangerously_log_query_text
      ? { dangerously_log_query_text: true }
      : {}),
  };
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
      if (typeof fromURL[key] === "object") {
        deepMerge(base, fromURL[key], path.concat(key));
      } else {
        let baseAtPath: Record<string, any> = base;
        for (const key of path) {
          if (baseAtPath[key] === undefined) {
            baseAtPath[key] = {};
          }
          baseAtPath = baseAtPath[key];
        }
        const baseAtKey = baseAtPath[key];
        if (baseAtKey !== undefined) {
          const fullPath = path.concat(key).join(".");
          logger.warn({
            module: "Config",
            message: `"${fullPath}" is overridden by a URL parameter.`,
          });
        }
        baseAtPath[key] = fromURL[key];
      }
    }
  }

  const config: Record<string, any> = { ...baseConfig };
  deepMerge(config, configFromURL);
  return config as BaseClickHouseClientConfigOptions;
}

export function createUrl(configURL: string | URL | undefined): URL {
  let url: URL;
  try {
    if (typeof configURL === "string" || configURL instanceof URL) {
      url = new URL(configURL);
    } else {
      return new URL("http://localhost:8123");
    }
  } catch (err) {
    throw new Error(
      "ClickHouse URL is malformed. Expected format: http[s]://[username:password@]hostname:port[/database][?param1=value1&param2=value2]",
      { cause: err },
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(
      `ClickHouse URL protocol must be either http or https. Got: ${url.protocol}`,
    );
  }
  return url;
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
  let config: BaseClickHouseClientConfigOptions = {};
  // trim is not needed, cause space is not allowed in the URL basic auth and should be encoded as %20
  if (url.username !== "") {
    config.username = decodeURIComponent(url.username);
  }
  if (url.password !== "") {
    config.password = decodeURIComponent(url.password);
  }
  if (url.pathname.trim().length > 1) {
    config.database = url.pathname.slice(1);
  }
  const urlSearchParamsKeys = [...url.searchParams.keys()];
  if (urlSearchParamsKeys.length > 0) {
    const unknownParams = new Set<string>();
    const settingPrefix = "clickhouse_setting_";
    const settingShortPrefix = "ch_";
    const httpHeaderPrefix = "http_header_";
    urlSearchParamsKeys.forEach((key) => {
      let paramWasProcessed = true;
      const value = url.searchParams.get(key) as string;
      if (key.startsWith(settingPrefix)) {
        // clickhouse_settings_*
        const settingKey = key.slice(settingPrefix.length);
        if (config.clickhouse_settings === undefined) {
          config.clickhouse_settings = {};
        }
        config.clickhouse_settings[settingKey] = value;
      } else if (key.startsWith(settingShortPrefix)) {
        // ch_*
        const settingKey = key.slice(settingShortPrefix.length);
        if (config.clickhouse_settings === undefined) {
          config.clickhouse_settings = {};
        }
        config.clickhouse_settings[settingKey] = value;
      } else if (key.startsWith(httpHeaderPrefix)) {
        // http_headers_*
        const headerKey = key.slice(httpHeaderPrefix.length);
        if (config.http_headers === undefined) {
          config.http_headers = {};
        }
        config.http_headers[headerKey] = value;
      } else {
        // static known parameters
        switch (key) {
          case "application":
            config.application = value;
            break;
          case "pathname":
            config.pathname = value;
            break;
          case "session_id":
            config.session_id = value;
            break;
          case "request_timeout":
            config.request_timeout = numberConfigURLValue({
              key,
              value,
              min: 0,
            });
            break;
          case "max_open_connections":
            config.max_open_connections = numberConfigURLValue({
              key,
              value,
              min: 1,
            });
            break;
          case "compression_request":
            if (config.compression === undefined) {
              config.compression = {};
            }
            config.compression.request = booleanConfigURLValue({ key, value });
            break;
          case "compression_response":
            if (config.compression === undefined) {
              config.compression = {};
            }
            config.compression.response = booleanConfigURLValue({
              key,
              value,
            });
            break;
          case "log_level":
            if (config.log === undefined) {
              config.log = {};
            }
            config.log.level = enumConfigURLValue({
              key,
              value,
              enumObject: ClickHouseLogLevel,
            }) as ClickHouseLogLevel;
            break;
          case "keep_alive_enabled":
            if (config.keep_alive === undefined) {
              config.keep_alive = {};
            }
            config.keep_alive.enabled = booleanConfigURLValue({ key, value });
            break;
          case "access_token":
            config.access_token = value;
            break;
          default:
            paramWasProcessed = false;
            unknownParams.add(key);
            break;
        }
      }
      if (paramWasProcessed) {
        // so it won't be passed to the impl URL params handler
        url.searchParams.delete(key);
      }
    });
    if (handleExtraURLParams !== null) {
      const res = handleExtraURLParams(config, url);
      config = res.config;
      if (unknownParams.size > 0) {
        res.handled_params.forEach((k) => unknownParams.delete(k));
      }
      if (res.unknown_params.size > 0) {
        res.unknown_params.forEach((k) => unknownParams.add(k));
      }
    }
    if (unknownParams.size > 0) {
      throw new Error(
        `Unknown URL parameters: ${Array.from(unknownParams).join(", ")}`,
      );
    }
  }
  // clean up the final ClickHouse URL to be used in the connection
  const clickHouseURL = new URL(`${url.protocol}//${url.host}`);
  return [clickHouseURL, config];
}

export function booleanConfigURLValue({
  key,
  value,
}: {
  key: string;
  value: string;
}): boolean {
  const trimmed = value.trim();
  if (trimmed === "true" || trimmed === "1") return true;
  if (trimmed === "false" || trimmed === "0") return false;
  throw new Error(
    `"${key}" has invalid boolean value: ${trimmed}. Expected one of: 0, 1, true, false.`,
  );
}

export function numberConfigURLValue({
  key,
  value,
  min,
  max,
}: {
  key: string;
  value: string;
  min?: number;
  max?: number;
}): number {
  const trimmed = value.trim();
  const number = Number(trimmed);
  if (isNaN(number))
    throw new Error(`"${key}" has invalid numeric value: ${trimmed}`);
  if (min !== undefined && number < min) {
    throw new Error(
      `"${key}" value ${trimmed} is less than min allowed ${min}`,
    );
  }
  if (max !== undefined && number > max) {
    throw new Error(
      `"${key}" value ${trimmed} is greater than max allowed ${max}`,
    );
  }
  return number;
}

export function enumConfigURLValue<Enum, Key extends string>({
  key,
  value,
  enumObject,
}: {
  key: string;
  value: string;
  enumObject: Record<Key, Enum>;
}): Enum {
  const values = Object.keys(enumObject).filter((item) => isNaN(Number(item)));
  const trimmed = value.trim();
  if (!values.includes(trimmed)) {
    const expected = values.join(", ");
    throw new Error(
      `"${key}" has invalid value: ${trimmed}. Expected one of: ${expected}.`,
    );
  }
  return enumObject[trimmed as Key];
}
