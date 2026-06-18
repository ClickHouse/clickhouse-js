import type { JSONHandling } from ".";
import type {
  WithClickHouseSummary,
  WithHttpStatusCode,
  WithResponseHeaders,
} from "./clickhouse_types";
import type { ClickHouseLogLevel, LogWriter } from "./logger";
import type { ClickHouseSettings } from "./settings";

export type ConnectionAuth =
  | { username: string; password: string; type: "Credentials" }
  | { access_token: string; type: "JWT" };

export interface ConnectionParams {
  url: URL;
  request_timeout: number;
  max_open_connections: number;
  compression: CompressionSettings;
  database: string;
  clickhouse_settings: ClickHouseSettings;
  log_writer: LogWriter;
  log_level: ClickHouseLogLevel;
  keep_alive: { enabled: boolean };
  application_id?: string;
  http_headers?: Record<string, string>;
  auth: ConnectionAuth;
  json?: JSONHandling;
  use_multipart_params?: boolean;
  use_multipart_params_auto?: boolean;
}

/** Compression codecs supported for the HTTP request (insert) and response
 *  (read) bodies. `zstd` requires Node.js >= 22.15.0 (zstd support in the
 *  built-in `zlib` module); `br` (Brotli) is available on every supported
 *  Node.js version. Request-body compression is performed only by
 *  `@clickhouse/client` (Node.js); on the web client, response decompression is
 *  handled by the browser and only `zstd` is rejected. */
export type CompressionMethod = "gzip" | "zstd" | "br";

/** Normalized request (insert) body compression, discriminated by codec so each
 *  codec carries its own tuning option: a `level` for gzip/zstd, a `quality` for
 *  Brotli. */
export type RequestCompression =
  | { codec: "gzip"; level?: number }
  | { codec: "zstd"; level?: number }
  | { codec: "br"; quality?: number };

/** Normalized response (read) body compression. The compression options are
 *  chosen by the ClickHouse server, so none are carried here. */
export type ResponseCompression =
  | { codec: "gzip" }
  | { codec: "zstd" }
  | { codec: "br" };

export interface CompressionSettings {
  /** Response decompression codec, or `undefined` to disable. */
  decompress_response: ResponseCompression | undefined;
  /** Request compression codec (with an optional codec-specific level), or
   *  `undefined` to disable. */
  compress_request: RequestCompression | undefined;
}

export interface ConnBaseQueryParams {
  query: string;
  clickhouse_settings?: ClickHouseSettings;
  query_params?: Record<string, unknown>;
  abort_signal?: AbortSignal;
  session_id?: string;
  query_id?: string;
  auth?: { username: string; password: string } | { access_token: string };
  role?: string | Array<string>;
  http_headers?: Record<string, string>;
  use_multipart_params?: boolean;
  use_multipart_params_auto?: boolean;
}

export type ConnPingParams = { select: boolean } & Omit<
  ConnBaseQueryParams,
  "query" | "query_params"
>;

export interface ConnCommandParams extends ConnBaseQueryParams {
  ignore_error_response?: boolean;
}

export interface ConnInsertParams<Stream> extends ConnBaseQueryParams {
  values: string | Stream;
}

export interface ConnExecParams<Stream> extends ConnBaseQueryParams {
  values?: Stream;
  decompress_response_stream?: boolean;
  ignore_error_response?: boolean;
}

export interface ConnBaseResult
  extends WithResponseHeaders, WithHttpStatusCode {
  query_id: string;
}

export interface ConnQueryResult<Stream> extends ConnBaseResult {
  stream: Stream;
  query_id: string;
}

export type ConnInsertResult = ConnBaseResult & WithClickHouseSummary;
export type ConnExecResult<Stream> = ConnQueryResult<Stream> &
  WithClickHouseSummary;
export type ConnCommandResult = ConnBaseResult & WithClickHouseSummary;

export type ConnPingResult =
  | {
      success: true;
    }
  | { success: false; error: Error };

export type ConnOperation = "Ping" | "Query" | "Insert" | "Exec" | "Command";

export interface Connection<Stream> {
  ping(params: ConnPingParams): Promise<ConnPingResult>;
  query(params: ConnBaseQueryParams): Promise<ConnQueryResult<Stream>>;
  insert(params: ConnInsertParams<Stream>): Promise<ConnInsertResult>;
  command(params: ConnCommandParams): Promise<ConnCommandResult>;
  exec(params: ConnExecParams<Stream>): Promise<ConnExecResult<Stream>>;
  close(): Promise<void>;
}
