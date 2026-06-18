/**
 * @deprecated The `@clickhouse/client-common` package is deprecated. It is no longer used by
 * `@clickhouse/client` or `@clickhouse/client-web`; the shared code is bundled into each client
 * package instead. Import everything from `@clickhouse/client` (Node.js) or
 * `@clickhouse/client-web` (Web) instead.
 *
 * @packageDocumentation
 */

/** Should be re-exported by the implementation */
export {
  type BaseQueryParams,
  type QueryParams,
  type QueryResult,
  type ExecParams,
  type InsertParams,
  /** @deprecated Import `ClickHouseClient` from `@clickhouse/client` instead. In Web projects, use `import type { ClickHouseClient } from '@clickhouse/client-web'`. Importing it from `@clickhouse/client-common` is deprecated. */
  ClickHouseClient,
  type CommandParams,
  type CommandResult,
  type ExecResult,
  type InsertResult,
  type PingResult,
  type PingParams,
  type PingParamsWithSelectQuery,
  type PingParamsWithEndpoint,
} from "./client";
export { type BaseClickHouseClientConfigOptions } from "./config";
export type {
  Row,
  RowOrProgress,
  BaseResultSet,
  ResultJSONType,
  RowJSONType,
  ResultStream,
} from "./result";
export type {
  DataFormat,
  RawDataFormat,
  JSONDataFormat,
  StreamableDataFormat,
  StreamableJSONDataFormat,
  SingleDocumentJSONFormat,
} from "./data_formatter";
export {
  /** @deprecated Import `SupportedJSONFormats` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  SupportedJSONFormats,
  /** @deprecated Import `SupportedRawFormats` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  SupportedRawFormats,
  /** @deprecated Import `StreamableFormats` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  StreamableFormats,
  /** @deprecated Import `StreamableJSONFormats` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  StreamableJSONFormats,
  /** @deprecated Import `SingleDocumentJSONFormats` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  SingleDocumentJSONFormats,
  /** @deprecated Import `RecordsJSONFormats` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  RecordsJSONFormats,
  /** @deprecated Import `TupleParam` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  TupleParam,
} from "./data_formatter";
export {
  /** @deprecated Import `ClickHouseError` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  ClickHouseError,
  /** @deprecated Import `parseError` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  parseError,
} from "./error";
export {
  /** @deprecated Import `ClickHouseLogLevel` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  ClickHouseLogLevel,
  type ErrorLogParams,
  type WarnLogParams,
  type Logger,
  type LogParams,
} from "./logger";
export type {
  ClickHouseSummary,
  InputJSON,
  InputJSONObjectEachRow,
  ResponseJSON,
  ResponseHeaders,
  WithClickHouseSummary,
  WithResponseHeaders,
  ProgressRow,
  InsertValues,
  ClickHouseAuth,
  ClickHouseJWTAuth,
  ClickHouseCredentialsAuth,
} from "./clickhouse_types";
export {
  /** @deprecated Import `isProgressRow` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  isProgressRow,
  /** @deprecated Import `isRow` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  isRow,
  /** @deprecated Import `isException` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  isException,
} from "./clickhouse_types";
export {
  type ClickHouseSettings,
  type MergeTreeSettings,
  /** @deprecated Import `SettingsMap` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  SettingsMap,
} from "./settings";
export type {
  SimpleColumnType,
  ParsedColumnSimple,
  ParsedColumnEnum,
  ParsedColumnFixedString,
  ParsedColumnNullable,
  ParsedColumnDecimal,
  ParsedColumnDateTime,
  ParsedColumnDateTime64,
  ParsedColumnArray,
  ParsedColumnTuple,
  ParsedColumnMap,
  ParsedColumnType,
  JSONHandling,
} from "./parse";
export {
  /** @deprecated Import `SimpleColumnTypes` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  SimpleColumnTypes,
  /** @deprecated Import `parseColumnType` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  parseColumnType,
  /** @deprecated Import `defaultJSONHandling` from `@clickhouse/client` (Node.js) or `@clickhouse/client-web` (Web) instead. Importing it from `@clickhouse/client-common` is deprecated. */
  defaultJSONHandling,
} from "./parse";
export {
  type ClickHouseTracer,
  type ClickHouseSpan,
  type ClickHouseSpanOptions,
  type ClickHouseSpanAttributes,
  type ClickHouseSpanStatus,
  type ClickHouseSpanName,
  ClickHouseSpanStatusCode,
  ClickHouseSpanKind,
  ClickHouseSpanNames,
  recordSpanError,
} from "./tracing";

/** For implementation usage only - should not be re-exported */
export {
  formatQuerySettings,
  formatQueryParams,
  encodeJSON,
  isSupportedRawFormat,
  isStreamableJSONFamily,
  isNotStreamableJSONFamily,
  validateStreamFormat,
} from "./data_formatter";
export {
  type ValuesEncoder,
  type MakeResultSet,
  type MakeConnection,
  type HandleImplSpecificURLParams,
  type ImplementationDetails,
  booleanConfigURLValue,
  enumConfigURLValue,
  getConnectionParams,
  numberConfigURLValue,
} from "./config";
export {
  EXCEPTION_TAG_HEADER_NAME,
  isSuccessfulResponse,
  sleep,
  buildMultipartBody,
  MAX_URL_BIND_PARAM_LENGTH,
  serializeQueryParamsForUrl,
  toSearchParams,
  transformUrl,
  withCompressionHeaders,
  withHttpSettings,
  isCredentialsAuth,
  isJWTAuth,
  extractErrorAtTheEndOfChunk,
  CARET_RETURN,
} from "./utils";
export { LogWriter, DefaultLogger, type LogWriterParams } from "./logger";
export { getCurrentStackTrace, enhanceStackTrace } from "./error";
export type {
  CompressionSettings,
  CompressionMethod,
  RequestCompression,
  ResponseCompression,
  Connection,
  ConnectionParams,
  ConnInsertResult,
  ConnExecParams,
  ConnExecResult,
  ConnQueryResult,
  ConnBaseQueryParams,
  ConnBaseResult,
  ConnInsertParams,
  ConnPingResult,
  ConnCommandResult,
  ConnOperation,
  ConnPingParams,
} from "./connection";
export type { QueryParamsWithFormat } from "./client";
export type { IsSame } from "./ts_utils";
