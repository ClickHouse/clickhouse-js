import type { ResponseJSON } from './clickhouse_types'
import {
  DataFormat,
  RawDataFormat,
  RecordsJSONFormat,
  SingleDocumentJSONFormat,
  StreamableDataFormat,
  StreamableJSONDataFormat,
} from './data_formatter'

export type ResultJSONType<T, F extends DataFormat | unknown> =
  // JSON*EachRow formats
  F extends StreamableJSONDataFormat
    ? T[]
    : // JSON formats with known layout { data, meta, statistics, ... }
    F extends SingleDocumentJSONFormat
    ? ResponseJSON<T>
    : // JSON formats returned as a Record<string, T>
    F extends RecordsJSONFormat
    ? Record<string, T>
    : // CSV, TSV etc. - cannot be represented as JSON
    F extends RawDataFormat
    ? never
    : T // technically, should never happen

export type RowJSONType<T, F extends DataFormat | unknown> =
  // JSON*EachRow formats
  F extends StreamableJSONDataFormat
    ? T
    : // CSV, TSV, non-streamable JSON formats - cannot be streamed as JSON
    F extends RawDataFormat | SingleDocumentJSONFormat | RecordsJSONFormat
    ? never
    : T // technically, should never happen

export interface Row<
  Format extends DataFormat | unknown = unknown,
  JSONType = unknown
> {
  /** A string representation of a row. */
  text: string

  /**
   * Returns a JSON representation of a row.
   * The method will throw if called on a response in JSON incompatible format.
   * It is safe to call this method multiple times.
   */
  json<T = JSONType>(): RowJSONType<T, Format>
}

export interface BaseResultSet<
  Stream,
  Format extends DataFormat | unknown = unknown
> {
  /**
   * The method waits for all the rows to be fully loaded
   * and returns the result as a string.
   *
   * It is possible to call this method for all supported formats.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  text(): Promise<string>

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   *
   * Should be called only for JSON* formats family.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods, or if it is called for non-JSON formats,
   * such as CSV, TSV etc.
   */
  json<T = unknown>(): Promise<ResultJSONType<T, Format>>

  /**
   * Returns a readable stream for responses that can be streamed.
   *
   * Formats that CAN be streamed ({@link StreamableDataFormat}):
   *   * JSONEachRow
   *   * JSONStringsEachRow
   *   * JSONCompactEachRow
   *   * JSONCompactStringsEachRow
   *   * JSONCompactEachRowWithNames
   *   * JSONCompactEachRowWithNamesAndTypes
   *   * JSONCompactStringsEachRowWithNames
   *   * JSONCompactStringsEachRowWithNamesAndTypes
   *   * CSV
   *   * CSVWithNames
   *   * CSVWithNamesAndTypes
   *   * TabSeparated
   *   * TabSeparatedRaw
   *   * TabSeparatedWithNames
   *   * TabSeparatedWithNamesAndTypes
   *   * CustomSeparated
   *   * CustomSeparatedWithNames
   *   * CustomSeparatedWithNamesAndTypes
   *   * Parquet
   *
   * Formats that CANNOT be streamed:
   *   * JSON
   *   * JSONStrings
   *   * JSONCompact
   *   * JSONCompactStrings
   *   * JSONColumnsWithMetadata
   *   * JSONObjectEachRow
   *
   * Every iteration provides an array of {@link Row} instances
   * for {@link StreamableDataFormat} format.
   *
   * Should be called only once.
   *
   * The method should throw if called on a response in non-streamable format,
   * and if the underlying stream was already consumed
   * by calling the other methods.
   */
  stream(): Stream

  /** Close the underlying stream. */
  close(): void

  /** ClickHouse server QueryID. */
  query_id: string
}
