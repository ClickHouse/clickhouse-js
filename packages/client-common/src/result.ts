import type {
  ProgressRow,
  ResponseHeaders,
  ResponseJSON,
  SpecialEventRow,
} from "./clickhouse_types";
import type {
  DataFormat,
  RawDataFormat,
  RecordsJSONFormat,
  SingleDocumentJSONFormat,
  StreamableDataFormat,
  StreamableJSONDataFormat,
} from "./data_formatter";

export type RowOrProgress<T> = { row: T } | ProgressRow | SpecialEventRow<T>;

export type ResultStream<Format extends DataFormat | unknown, Stream> =
  // JSON*EachRow (except JSONObjectEachRow), CSV, TSV etc.
  Format extends StreamableDataFormat
    ? Stream
    : // JSON formats represented as an object { data, meta, statistics, ... }
      Format extends SingleDocumentJSONFormat
      ? never
      : // JSON formats represented as a Record<string, T>
        Format extends RecordsJSONFormat
        ? never
        : // If we fail to infer the literal type, allow getting the stream
          Stream;

export type ResultJSONType<T, F extends DataFormat | unknown> =
  // Emits either a { row: T } or an object with progress
  F extends "JSONEachRowWithProgress"
    ? RowOrProgress<T>[]
    : // JSON*EachRow formats except JSONObjectEachRow
      F extends StreamableJSONDataFormat
      ? T[]
      : // JSON formats with known layout { data, meta, statistics, ... }
        F extends SingleDocumentJSONFormat
        ? ResponseJSON<T>
        : // JSON formats represented as a Record<string, T>
          F extends RecordsJSONFormat
          ? Record<string, T>
          : // CSV, TSV, etc. - cannot be represented as JSON
            F extends RawDataFormat
            ? never
            : // happens only when Format could not be inferred from a literal
              T[] | Record<string, T> | ResponseJSON<T>;

export type RowJSONType<T, F extends DataFormat | unknown> =
  // Emits either a { row: T } or an object with progress
  F extends "JSONEachRowWithProgress"
    ? RowOrProgress<T>
    : // JSON*EachRow formats
      F extends StreamableJSONDataFormat
      ? T
      : // CSV, TSV, non-streamable JSON formats - cannot be streamed as JSON
        F extends RawDataFormat | SingleDocumentJSONFormat | RecordsJSONFormat
        ? never
        : T; // happens only when Format could not be inferred from a literal

export interface Row<
  JSONType = unknown,
  Format extends DataFormat | unknown = unknown,
> {
  /** A string representation of a row. */
  text: string;

  /**
   * Returns a JSON representation of a row.
   * The method will throw if called on a response in JSON incompatible format.
   * It is safe to call this method multiple times.
   */
  json<T = JSONType>(): RowJSONType<T, Format>;
}

export interface BaseResultSet<
  Stream,
  Format extends DataFormat | unknown,
  BinaryStream = Stream,
  RawStream = BinaryStream,
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
  text(): Promise<string>;

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   *
   * Should be called only for JSON* formats family.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods, or if it is called for non-JSON formats,
   * such as CSV, TSV, etc.
   */
  json<T = unknown>(): Promise<ResultJSONType<T, Format>>;

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
   * For a binary format such as `Parquet`, use {@link binaryStream}: this
   * method splits the response into rows at each newline byte and decodes
   * the rows as UTF-8 text, so the rows do not give the original bytes.
   *
   * Formats that CANNOT be streamed (the method returns "never" in TS):
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
  stream(): ResultStream<Format, Stream>;

  /**
   * Returns a readable stream of the response bytes, without a split into
   * rows. Use it for binary formats such as `Parquet`: the bytes are the same
   * as the bytes that the server sent. It is possible to call this method for
   * all formats.
   *
   * Each chunk is a `Buffer` in Node.js and a `Uint8Array` in the Web client.
   *
   * With ClickHouse 25.11+, the server can send an error after a part of the
   * result (a mid-stream exception). Then the stream gives the bytes before
   * the error, and after them it fails with a `ClickHouseError` that has the
   * code and the type of the server error. With older servers, the error text
   * is part of the bytes. The stream of `client.exec()` does not find this
   * error.
   *
   * Should be called only once.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  binaryStream(): BinaryStream;

  /**
   * Returns the response stream as it comes from the transport. This method
   * does not find a mid-stream exception: if the server sends an error after
   * a part of the result, the bytes of the error are part of the stream, and
   * the stream then fails with a network error, because the server closes the
   * connection. Use {@link binaryStream} if you want to get the server error.
   *
   * Should be called only once.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  rawStream(): RawStream;

  /** Close the underlying stream. */
  close(): void;

  /** ClickHouse server QueryID. */
  query_id: string;

  /** Response headers. */
  response_headers: ResponseHeaders;
}
