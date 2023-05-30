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

export interface IResultSet<Stream> {
  /** Consume the entire result set as a string. */
  text(): Promise<string>
  /** Parse the entire result set as a JSON object. */
  json<T>(): Promise<T>
  /** Get a stream of Row objects. */
  stream(): Stream
  /** Close the underlying stream. */
  close(): void
  /** ClickHouse server QueryID. */
  query_id: string
}
