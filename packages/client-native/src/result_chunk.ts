/**
 * A part of the result of `query()`.
 *
 * The connection decodes the `Native` blocks of the server. The result set
 * needs them as text (`text()`, `stream()`) or as JS values (`json()`). The
 * connection does not know which: it gives the result set these parts, and
 * the result set asks each part for the form that it needs.
 *
 * Use the parts in their sequence, and call only one of the two functions of
 * each part, one time: the text of a part depends on the parts before it.
 */
export interface ResultChunk {
  /** The text of the part in the format of the query. It is a Buffer when
   *  a string of the result has bytes that are not UTF-8. */
  text(): string | Buffer;
  /**
   * The rows of the part as the values that `JSON.parse` gives for their
   * text, and the text of the part without these rows. Only the parts with
   * rows of some JSON formats have this function. The values are made from
   * the decoded block: the client does not write and parse their text.
   */
  rows?: () => { rows: unknown[]; text: string | Buffer };
  /** Decoded (uncompressed) byte length of the underlying Native block,
   *  used for tracing when `rows()` skips text formatting. */
  bytes?: number;
}

export function isResultChunk(value: unknown): value is ResultChunk {
  return (
    typeof value === "object" &&
    value !== null &&
    !Buffer.isBuffer(value) &&
    typeof (value as ResultChunk).text === "function"
  );
}
