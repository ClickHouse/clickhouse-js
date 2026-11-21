import type {
  BaseResultSet,
  ClickHouseSpan,
  ClickHouseSpanAttributes,
  DataFormat,
  JSONHandling,
  ResponseHeaders,
  ResultJSONType,
  ResultStream,
  Row,
} from "./common/index";
import {
  extractErrorAtTheEndOfChunk,
  defaultJSONHandling,
  EXCEPTION_TAG_HEADER_NAME,
  CARET_RETURN,
  recordSpanError,
} from "./common/index";
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  RecordsJSONFormats,
  validateStreamFormat,
} from "./common/index";
import { NoopClickHouseSpan } from "./common/tracing";
import { Buffer } from "buffer";
import type { Readable, TransformCallback } from "stream";
import Stream, { Transform } from "stream";
import { getAsText } from "./utils";
import { isResultChunk } from "./result_chunk";

const NEWLINE = 0x0a as const;

/** {@link Stream.Readable} with additional types for the `on(data)` method and the async iterator.
 * Everything else is an exact copy from stream.d.ts */
export type StreamReadable<T> = Omit<Stream.Readable, "on"> & {
  [Symbol.asyncIterator](): NodeJS.AsyncIterator<T>;
  on(event: "data", listener: (chunk: T) => void): Stream.Readable;
  on(
    event:
      | "close"
      | "drain"
      | "end"
      | "finish"
      | "pause"
      | "readable"
      | "resume"
      | "unpipe",
    listener: () => void,
  ): Stream.Readable;
  on(event: "error", listener: (err: Error) => void): Stream.Readable;
  on(event: "pipe", listener: (src: Readable) => void): Stream.Readable;
  on(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): Stream.Readable;
};

export interface ResultSetOptions<Format extends DataFormat> {
  stream: Stream.Readable;
  format: Format;
  query_id: string;
  log_error: (error: Error) => void;
  response_headers: ResponseHeaders;
  jsonHandling?: JSONHandling;
  span?: ClickHouseSpan;
}

export class ResultSet<
  Format extends DataFormat | unknown,
> implements BaseResultSet<Stream.Readable, Format> {
  public readonly response_headers: ResponseHeaders = {};

  private readonly exceptionTag: string | undefined = undefined;
  private readonly log_error: (error: Error) => void;
  private readonly jsonHandling: JSONHandling;
  private _consumed = false;
  /**
   * The stream of the response body.
   *
   * It is expected that the stream is passed directly from the response of the HTTP request
   * and has not been consumed or altered yet.
   */
  private _stream: Stream.Readable;
  private readonly format: Format;
  /** The `clickhouse.query.stream` span owned by this result set (if the
   *  client was configured with a tracer); it ends via {@link finishSpan}
   *  when the response stream is fully consumed, closed, or fails. */
  private readonly span: ClickHouseSpan | undefined;
  /** Decoded (decompressed) bytes received from the server so far. */
  private span_bytes = 0;
  /** Rows decoded from the response stream so far. */
  private span_rows = 0;
  private span_rows_counted = false;
  private span_finished = false;
  public readonly query_id: string;

  constructor(
    _stream: Stream.Readable,
    format: Format,
    query_id: string,
    log_error?: (error: Error) => void,
    _response_headers?: ResponseHeaders,
    jsonHandling?: JSONHandling,
    span?: ClickHouseSpan,
  ) {
    this._stream = _stream;
    this.format = format;
    this.query_id = query_id;
    this.span = span;
    this.jsonHandling = {
      ...defaultJSONHandling,
      ...jsonHandling,
    };
    // eslint-disable-next-line no-console
    this.log_error = log_error ?? ((err: Error) => console.error(err));

    if (_response_headers !== undefined) {
      this.response_headers = Object.freeze(_response_headers);
      this.exceptionTag = _response_headers[EXCEPTION_TAG_HEADER_NAME] as
        string | undefined;
    }
  }

  private consume() {
    if (this._consumed) {
      throw new Error(streamAlreadyConsumedMessage);
    }
    this._consumed = true;
    return this._stream;
  }

  /** Add the number of rows decoded from the response stream. */
  private addSpanRows(count: number): void {
    this.span_rows_counted = true;
    this.span_rows += count;
  }

  private hasActiveSpan(): boolean {
    return this.span !== undefined && this.span !== NoopClickHouseSpan;
  }

  /** Add the UTF-8 byte length of a chunk when tracing is active. */
  private addSpanBytes(part: string | Buffer): void {
    if (!this.hasActiveSpan()) return;
    this.span_bytes +=
      typeof part === "string" ? Buffer.byteLength(part) : part.length;
  }

  /** Record the final response metrics (`clickhouse.response.decoded_bytes`
   *  and, when rows were counted, `db.response.returned_rows`) and the error
   *  (if any) on the span, and end it. Safe to call multiple times - only
   *  the first call wins. */
  private finishSpan(err?: unknown): void {
    if (!this.span || this.span_finished) {
      return;
    }
    this.span_finished = true;
    const attributes: ClickHouseSpanAttributes = {
      "clickhouse.response.decoded_bytes": this.span_bytes,
    };
    if (this.span_rows_counted) {
      attributes["db.response.returned_rows"] = this.span_rows;
    }
    this.span.setAttributes(attributes);
    if (err) {
      recordSpanError(this.span, err);
    }
    this.span.end();
  }

  /** See {@link BaseResultSet.text}. */
  async text(): Promise<string> {
    const stream = this.consume();
    try {
      const text = await getAsText(stream);
      this.addSpanBytes(text);
      this.finishSpan();
      return text;
    } catch (err) {
      this.finishSpan(err);
      throw err;
    }
  }

  /** See {@link BaseResultSet.json}. */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    // The parts of the result give their rows as JS values (see ResultChunk).
    // With a JSON parser of the caller, the result set gives it the text.
    const direct = this.jsonHandling.parse === defaultJSONHandling.parse;
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const stream = this.consume();
      const result: T[] = [];
      const parse = this.jsonHandling.parse;
      // The text after the last newline: the start of a row.
      let rest = "";
      const parseLines = (part: string | Buffer): void => {
        if (part.length === 0) return;
        const text = rest + (typeof part === "string" ? part : part.toString());
        this.addSpanBytes(part);
        let start = 0;
        for (;;) {
          const end = text.indexOf("\n", start);
          if (end === -1) break;
          result.push(parse(text.slice(start, end)));
          start = end + 1;
        }
        rest = start === 0 ? text : text.slice(start);
      };
      try {
        for await (const chunk of stream) {
          if (!isResultChunk(chunk)) {
            parseLines(chunk as string | Buffer);
          } else if (direct && chunk.rows !== undefined) {
            const part = chunk.rows();
            parseLines(part.text);
            if (this.hasActiveSpan() && chunk.bytes !== undefined) {
              this.span_bytes += chunk.bytes;
            }
            for (const row of part.rows) result.push(row as T);
          } else {
            parseLines(chunk.text());
          }
        }
        this.addSpanRows(result.length);
        this.finishSpan();
      } catch (err) {
        if ((err as Error).message !== resultSetClosedMessage) {
          this.log_error(err as Error);
        }
        this.finishSpan(err);
        throw err;
      }
      return result as ResultJSONType<T, Format>;
    }
    // JSON, JSONObjectEachRow, etc.
    if (isNotStreamableJSONFamily(this.format as DataFormat)) {
      const stream = this.consume();
      try {
        // The rows of the `data` field, when the parts give them as values.
        let data: unknown[] | undefined;
        let text = "";
        const add = (part: string | Buffer): void => {
          text += typeof part === "string" ? part : part.toString();
        };
        for await (const chunk of stream) {
          if (!isResultChunk(chunk)) {
            add(chunk as string | Buffer);
          } else if (direct && chunk.rows !== undefined) {
            const part = chunk.rows();
            add(part.text);
            if (this.hasActiveSpan() && chunk.bytes !== undefined) {
              this.span_bytes += chunk.bytes;
            }
            data ??= [];
            for (const row of part.rows) data.push(row);
          } else {
            add(chunk.text());
          }
        }
        this.addSpanBytes(text);
        const parsed = this.jsonHandling.parse<ResultJSONType<T, Format>>(text);
        if (data !== undefined) {
          // The text is the document without the rows.
          const document = parsed as { data: unknown[]; rows?: number };
          document.data = data;
          if (document.rows !== undefined) document.rows = data.length;
        }
        // Record the returned row count for non-streaming consumption too, so
        // `db.response.returned_rows` is present regardless of the format /
        // consumption style (see countReturnedRows).
        const rows = countReturnedRows(parsed, this.format as DataFormat);
        if (rows !== undefined) {
          this.addSpanRows(rows);
        }
        this.finishSpan();
        return parsed;
      } catch (err) {
        this.finishSpan(err);
        throw err;
      }
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} as JSON`);
  }

  /** See {@link BaseResultSet.stream}. */
  stream<T>(): ResultStream<Format, StreamReadable<Row<T, Format>[]>> {
    validateStreamFormat(this.format);

    const incompleteChunks: Buffer[] = [];
    // The text after the last newline of the parts that are strings.
    let textRest = "";
    const logError = this.log_error;
    const exceptionTag = this.exceptionTag;
    const jsonHandling = this.jsonHandling;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const resultSet = this;
    const toRows = new Transform({
      transform(
        part: unknown,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        // The result of query() comes in parts (see ResultChunk).
        let chunk: string | Buffer;
        try {
          chunk = isResultChunk(part) ? part.text() : (part as Buffer);
        } catch (err) {
          return callback(err as Error);
        }
        resultSet.addSpanBytes(chunk);
        const rows: Row[] = [];

        if (typeof chunk === "string") {
          if (incompleteChunks.length === 0) {
            // The usual case: cut the text into rows without a copy to bytes.
            const text = textRest + chunk;
            let start = 0;
            for (;;) {
              const end = text.indexOf("\n", start);
              if (end === -1) break;
              const rowText = text.slice(start, end);
              rows.push({
                text: rowText,
                json<T>(): T {
                  return jsonHandling.parse(rowText);
                },
              });
              start = end + 1;
            }
            textRest = start === 0 ? text : text.slice(start);
            if (rows.length > 0) {
              resultSet.addSpanRows(rows.length);
              this.push(rows);
            }
            return callback();
          }
          chunk = Buffer.from(chunk);
        } else if (textRest.length > 0) {
          incompleteChunks.push(Buffer.from(textRest));
          textRest = "";
        }

        let lastIdx = 0;
        let currentChunkPart: Buffer;

        while (true) {
          // an unescaped newline character denotes the end of a row,
          // or at least the beginning of the exception marker
          const idx = chunk.indexOf(NEWLINE, lastIdx);
          if (idx === -1) {
            incompleteChunks.push(chunk.subarray(lastIdx));
            if (rows.length > 0) {
              resultSet.addSpanRows(rows.length);
              this.push(rows);
            }
            break;
          } else {
            // Check for exception in the chunk (only after 25.11)
            if (
              exceptionTag !== undefined &&
              idx >= 1 &&
              chunk[idx - 1] === CARET_RETURN
            ) {
              return callback(extractErrorAtTheEndOfChunk(chunk, exceptionTag));
            }

            if (incompleteChunks.length > 0) {
              incompleteChunks.push(chunk.subarray(lastIdx, idx));
              currentChunkPart = Buffer.concat(incompleteChunks);
              // Removing used buffers and reusing the already allocated memory
              // by setting length to 0
              incompleteChunks.length = 0;
            } else {
              currentChunkPart = chunk.subarray(lastIdx, idx);
            }

            const text = currentChunkPart.toString();
            rows.push({
              text,
              json<T>(): T {
                return jsonHandling.parse(text);
              },
            });
            lastIdx = idx + 1; // skipping newline character
          }
        }
        callback();
      },
      autoDestroy: true,
      objectMode: true,
    });

    const pipeline = Stream.pipeline(
      this.consume(),
      toRows,
      function pipelineCb(err) {
        if (
          err &&
          err.name !== "AbortError" &&
          err.message !== resultSetClosedMessage
        ) {
          logError(err);
          resultSet.finishSpan(err);
        } else {
          resultSet.finishSpan();
        }
      },
    );
    return pipeline as any;
  }

  /** See {@link BaseResultSet.close}. */
  close() {
    // NB: _consumed is intentionally NOT set here. The stream is destroyed
    // (not read to completion), so marking it as "consumed" would produce the
    // misleading "Stream has been already consumed" error on any subsequent
    // call. Downstream code will instead receive a "ResultSet has been closed"
    // error from the destroyed stream, which accurately describes what happened.
    // Skipped when the stream is already destroyed, so that repeated calls do
    // not keep adding listeners.
    if (!this._stream.destroyed) {
      this._stream.on("error", ignoreClosureError);
      this._stream.destroy(new Error(resultSetClosedMessage));
    }
    this.finishSpan();
  }

  /**
   * Closes the `ResultSet`.
   *
   * Automatically called when using `using` statement in supported environments.
   * @see {@link ResultSet.close}
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using
   */
  [Symbol.dispose]() {
    this.close();
  }

  static instance<Format extends DataFormat>({
    stream,
    format,
    query_id,
    log_error,
    response_headers,
    jsonHandling,
    span,
  }: ResultSetOptions<Format>): ResultSet<Format> {
    return new ResultSet(
      stream,
      format,
      query_id,
      log_error,
      response_headers,
      jsonHandling,
      span,
    );
  }
}

const streamAlreadyConsumedMessage = "Stream has been already consumed";
const resultSetClosedMessage = "ResultSet has been closed";
/** The error emitted by `close()` only signals the closure: without a listener,
 *  destroying a stream that has none would throw it as uncaught. */
function ignoreClosureError(): void {
  // expected: the error is the closure signal
}

/** Best-effort row count for a fully-parsed non-streaming JSON document, used
 *  to populate `db.response.returned_rows` for `json()` consumption. Returns
 *  `undefined` when the shape is unrecognized (the attribute is then omitted).
 *  - `JSONObjectEachRow` (and other record formats) parse to `Record<string, T>`
 *    -> the number of keys.
 *  - `JSON`, `JSONCompact`, etc. parse to `{ data: T[], rows: number, ... }`
 *    -> the reported `rows`, falling back to `data.length`. */
function countReturnedRows(
  parsed: unknown,
  format: DataFormat,
): number | undefined {
  if (parsed === null || typeof parsed !== "object") {
    return undefined;
  }
  if ((RecordsJSONFormats as readonly string[]).includes(format)) {
    return Object.keys(parsed).length;
  }
  const obj = parsed as { rows?: unknown; data?: unknown };
  if (typeof obj.rows === "number") {
    return obj.rows;
  }
  if (Array.isArray(obj.data)) {
    return obj.data.length;
  }
  return undefined;
}
