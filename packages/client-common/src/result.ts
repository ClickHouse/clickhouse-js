import type { ClickHouseSummary } from './clickhouse_types'

export interface Row {
  /** A string representation of a row. */
  text: string

  /**
   * Returns a JSON representation of a row.
   * The method will throw if called on a response in JSON incompatible format.
   * It is safe to call this method multiple times.
   */
  json<T>(): T
}

export interface BaseResultSet<Stream> {
  /**
   * The method waits for all the rows to be fully loaded
   * and returns the result as a string.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  text(): Promise<string>

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   *
   * The method should throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  json<T>(): Promise<T>

  /**
   * Returns a readable stream for responses that can be streamed
   * (i.e. all except JSON).
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

  summary(): ResultSetSummary

  /** ClickHouse server QueryID. */
  query_id: string
}

/**
 * X-ClickHouse-Summary header + additional client-side statistics.
 * If the server does not provide this header, or it could not be parsed,
 * {@link ResultSetSummary.server} will be undefined.
 */
export type ResultSetSummary = {
  /** X-ClickHouse-Summary header, if it was parsed */
  server?: ClickHouseSummary
  /** Additional client-side statistics */
  client: {
    /** Time spent on processing the response on the client side (in milliseconds) */
    response_processing_time_ms: number
    /** Bytes from the response processed by the client */
    response_processed_bytes: number
  }
}
