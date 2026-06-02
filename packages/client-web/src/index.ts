export {
  type WebClickHouseClient as ClickHouseClient,
  type QueryResult,
} from './client'
export { createClient } from './client'
export { type WebClickHouseClientConfigOptions as ClickHouseClientConfigOptions } from './config'
export { ResultSet } from './result_set'

/** Re-export @clickhouse/client-common types */
export {
  type BaseClickHouseClientConfigOptions,
  type BaseQueryParams,
  type QueryParams,
  type ExecParams,
  type InsertParams,
  type InsertValues,
  type CommandParams,
  type CommandResult,
  type ExecResult,
  type InsertResult,
  type DataFormat,
  type RawDataFormat,
  type JSONDataFormat,
  type StreamableDataFormat,
  type StreamableJSONDataFormat,
  type SingleDocumentJSONFormat,
  type Logger,
  type LogParams,
  type ErrorLogParams,
  type WarnLogParams,
  type ClickHouseSettings,
  type MergeTreeSettings,
  type Row,
  type ResponseJSON,
  type InputJSON,
  type InputJSONObjectEachRow,
  type BaseResultSet,
  type PingResult,
  type ResponseHeaders,
  type SimpleColumnType,
  type ParsedColumnSimple,
  type ParsedColumnEnum,
  type ParsedColumnFixedString,
  type ParsedColumnNullable,
  type ParsedColumnDecimal,
  type ParsedColumnDateTime,
  type ParsedColumnDateTime64,
  type ParsedColumnArray,
  type ParsedColumnTuple,
  type ParsedColumnMap,
  type ParsedColumnType,
  type ProgressRow,
  type RowOrProgress,
  type ClickHouseAuth,
  type ClickHouseJWTAuth,
  type ClickHouseCredentialsAuth,
  type ClickHouseTracer,
  type ClickHouseTracerSpanAttributes,
  type ClickHouseTracerSpanStatus,
  type ClickHouseSpanName,
} from '@clickhouse/client-common'

/**
 * Re-export @clickhouse/client-common runtime values.
 *
 * These are intentionally re-exported through local bindings (rather than a direct
 * `export { ... } from '@clickhouse/client-common'`) so that the `@deprecated` JSDoc tags
 * applied to them in `@clickhouse/client-common` are NOT propagated to consumers of this package.
 * Importing these values from `@clickhouse/client-web` is the recommended, non-deprecated path.
 */
import {
  ClickHouseError as ClickHouseError_,
  parseError as parseError_,
  ClickHouseLogLevel as ClickHouseLogLevel_,
  SettingsMap as SettingsMap_,
  SupportedJSONFormats as SupportedJSONFormats_,
  SupportedRawFormats as SupportedRawFormats_,
  StreamableFormats as StreamableFormats_,
  StreamableJSONFormats as StreamableJSONFormats_,
  SingleDocumentJSONFormats as SingleDocumentJSONFormats_,
  RecordsJSONFormats as RecordsJSONFormats_,
  parseColumnType as parseColumnType_,
  SimpleColumnTypes as SimpleColumnTypes_,
  isProgressRow as isProgressRow_,
  isRow as isRow_,
  isException as isException_,
  TupleParam as TupleParam_,
  ClickHouseSpanNames as ClickHouseSpanNames_,
  defaultJSONHandling as defaultJSONHandling_,
} from '@clickhouse/client-common'

export const ClickHouseError = ClickHouseError_
export type ClickHouseError = ClickHouseError_
export const parseError = parseError_
export const ClickHouseLogLevel = ClickHouseLogLevel_
export type ClickHouseLogLevel = ClickHouseLogLevel_
export const SettingsMap = SettingsMap_
export type SettingsMap = SettingsMap_
export const SupportedJSONFormats = SupportedJSONFormats_
export const SupportedRawFormats = SupportedRawFormats_
export const StreamableFormats = StreamableFormats_
export const StreamableJSONFormats = StreamableJSONFormats_
export const SingleDocumentJSONFormats = SingleDocumentJSONFormats_
export const RecordsJSONFormats = RecordsJSONFormats_
export const parseColumnType = parseColumnType_
export const SimpleColumnTypes = SimpleColumnTypes_
export const isProgressRow = isProgressRow_
export const isRow = isRow_
export const isException = isException_
export const TupleParam = TupleParam_
export type TupleParam = TupleParam_
export const ClickHouseSpanNames = ClickHouseSpanNames_
export const defaultJSONHandling = defaultJSONHandling_
