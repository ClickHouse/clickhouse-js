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
} from "@clickhouse/client-common";
import {
  CARET_RETURN,
  extractErrorAtTheEndOfChunk,
  recordSpanError,
} from "@clickhouse/client-common";
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  validateStreamFormat,
} from "@clickhouse/client-common";
import { getAsText } from "./utils";

const NEWLINE = 0x0a as const;

/** The WHATWG Streams spec includes a `cancel` callback on `Transformer`, but
 *  TypeScript's DOM lib does not yet declare it.  This local extension adds it
 *  so we can detect source-stream aborts and consumer-side cancellations. */
type TransformerWithCancel<I = any, O = any> = Transformer<I, O> & {
  cancel?: (reason?: unknown) => void | PromiseLike<void>;
};

export class ResultSet<
  Format extends DataFormat | unknown,
> implements BaseResultSet<ReadableStream<Row[]>, Format> {
  public readonly response_headers: ResponseHeaders;

  private readonly exceptionTag: string | undefined = undefined;
  private isAlreadyConsumed = false;
  private readonly jsonHandling: JSONHandling;
  private _stream: ReadableStream;
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
    _stream: ReadableStream,
    format: Format,
    query_id: string,
    _response_headers?: ResponseHeaders,
    jsonHandling: JSONHandling = {
      parse: JSON.parse,
      stringify: JSON.stringify,
    },
    span?: ClickHouseSpan,
  ) {
    this._stream = _stream;
    this.format = format;
    this.query_id = query_id;
    this.span = span;
    this.response_headers =
      _response_headers !== undefined ? Object.freeze(_response_headers) : {};
    this.exceptionTag = this.response_headers["x-clickhouse-exception-tag"] as
      | string
      | undefined;

    this.jsonHandling = jsonHandling;
  }

  /** See {@link BaseResultSet.text} */
  async text(): Promise<string> {
    this.markAsConsumed();
    try {
      const text = await getAsText(this._stream);
      this.span_bytes += new TextEncoder().encode(text).length;
      this.finishSpan();
      return text;
    } catch (err) {
      this.finishSpan(err);
      throw err;
    }
  }

  /** See {@link BaseResultSet.json} */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const result: T[] = [];
      // The span progress is updated and the span is finished by the stream() pipeline.
      const reader = this.stream<T>().getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          for (const row of value) {
            result.push(row.json() as T);
          }
        }
      } catch (err) {
        this.finishSpan(err);
        throw err;
      }
      return result as any;
    }
    // JSON, JSONObjectEachRow, etc.
    if (isNotStreamableJSONFamily(this.format as DataFormat)) {
      try {
        const text = await getAsText(this._stream);
        this.span_bytes += new TextEncoder().encode(text).length;
        this.finishSpan();
        return this.jsonHandling.parse(text);
      } catch (err) {
        this.finishSpan(err);
        throw err;
      }
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} as JSON`);
  }

  /** See {@link BaseResultSet.stream} */
  stream<T>(): ResultStream<Format, ReadableStream<Row<T, Format>[]>> {
    this.markAsConsumed();
    validateStreamFormat(this.format);

    const incompleteChunks: Uint8Array[] = [];
    let totalIncompleteLength = 0;

    const exceptionTag = this.exceptionTag;
    const jsonHandling = this.jsonHandling;
    const decoder = new TextDecoder("utf-8");
    const transformerOptions: TransformerWithCancel<Uint8Array, Row[]> = {
      start() {
        //
      },
      transform: (chunk: Uint8Array, controller) => {
        if (chunk === null) {
          controller.terminate();
        }

        this.span_bytes += chunk.length;
        const rows: Row[] = [];

        let idx: number;
        let lastIdx = 0;

        while (true) {
          // an unescaped newline character denotes the end of a row,
          // or at least the beginning of the exception marker
          idx = chunk.indexOf(NEWLINE, lastIdx);
          if (idx === -1) {
            // there is no complete row in the rest of the current chunk
            // to be processed during the next transform iteration
            const incompleteChunk = chunk.slice(lastIdx);
            incompleteChunks.push(incompleteChunk);
            totalIncompleteLength += incompleteChunk.length;

            // send the extracted rows to the consumer, if any
            if (rows.length > 0) {
              this.addSpanRows(rows.length);
              controller.enqueue(rows);
            }
            break;
          } else {
            let bytesToDecode: Uint8Array;

            // Check for exception in the chunk (only after 25.11)
            if (
              exceptionTag !== undefined &&
              idx >= 1 &&
              chunk[idx - 1] === CARET_RETURN
            ) {
              const err = extractErrorAtTheEndOfChunk(chunk, exceptionTag);
              this.finishSpan(err);
              controller.error(err);
              return; // stop further processing once the stream is errored
            }

            // using the incomplete chunks from the previous iterations
            if (incompleteChunks.length > 0) {
              const completeRowBytes = new Uint8Array(
                totalIncompleteLength + idx,
              );

              let offset = 0;
              incompleteChunks.forEach((incompleteChunk) => {
                completeRowBytes.set(incompleteChunk, offset);
                offset += incompleteChunk.length;
              });

              // finalize the row with the current chunk slice that ends with a newline
              const finalChunk = chunk.slice(0, idx);
              completeRowBytes.set(finalChunk, offset);

              // Reset the incomplete chunks.
              // Removing used buffers and reusing the already allocated memory
              // by setting length to 0
              incompleteChunks.length = 0;
              totalIncompleteLength = 0;

              bytesToDecode = completeRowBytes;
            } else {
              bytesToDecode = chunk.slice(lastIdx, idx);
            }

            const text = decoder.decode(bytesToDecode);
            rows.push({
              text,
              json<T>(): T {
                return jsonHandling.parse(text);
              },
            });

            lastIdx = idx + 1; // skipping newline character
          }
        }
      },
      flush: () => {
        // The readable side of the transform completes when the source
        // stream is fully consumed - finalize the query span.
        this.finishSpan();
      },
      cancel: (reason?: unknown) => {
        // Called when the readable side is cancelled by the consumer, or
        // when the writable side is aborted (e.g. source stream network
        // error).  Either way, the span must be properly ended.
        this.finishSpan(reason);
      },
    };
    const transform = new TransformStream(transformerOptions);

    const pipeline = this._stream.pipeThrough(transform, {
      preventClose: false,
      preventAbort: false,
      preventCancel: false,
    });
    return pipeline as any;
  }

  async close(): Promise<void> {
    this.markAsConsumed();
    await this._stream.cancel();
    this.finishSpan();
  }

  /**
   * Closes the `ResultSet`.
   *
   * Automatically called when using `using` statement in supported environments.
   * @see {@link ResultSet.close}
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using
   */
  async [Symbol.asyncDispose]() {
    await this.close();
  }

  private markAsConsumed() {
    if (this.isAlreadyConsumed) {
      throw new Error(streamAlreadyConsumedMessage);
    }
    this.isAlreadyConsumed = true;
  }

  /** Add the number of rows decoded from the response stream. */
  private addSpanRows(count: number): void {
    this.span_rows_counted = true;
    this.span_rows += count;
  }

  /** Record the final response metrics (`clickhouse.response.decoded_bytes`
   *  and, when rows were counted, `db.response.returned_rows`) and the error
   *  (if any) on the span, and end it. Safe to call multiple times - only
   *  the first call wins. */
  private finishSpan(err?: unknown): void {
    if (this.span === undefined || this.span_finished) {
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
    if (err !== undefined && err !== null) {
      recordSpanError(this.span, err);
    }
    this.span.end();
  }
}

const streamAlreadyConsumedMessage = "Stream has been already consumed";
