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
  BinaryExceptionScanner,
  errorFromExceptionBlock,
  matchExceptionBlockStart,
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
import { Buffer } from "buffer";
import type { Readable, TransformCallback } from "stream";
import Stream, { Transform } from "stream";
import { getAsText } from "./utils";
import { createJSONEachRowErrorDetector } from "./common/utils/stream";

const NEWLINE = 0x0a as const;

/** The last byte of the incomplete row, or `undefined` if it is empty. */
function lastByte(chunks: Buffer[]): number | undefined {
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i]!;
    if (chunk.length > 0) {
      return chunk[chunk.length - 1];
    }
  }
  return undefined;
}

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
> implements BaseResultSet<
  Stream.Readable,
  Format,
  StreamReadable<Buffer>,
  Stream.Readable
> {
  public readonly response_headers: ResponseHeaders = {};

  private readonly exceptionTag: string | undefined = undefined;
  private readonly log_error: (error: Error) => void;
  private readonly jsonHandling: JSONHandling;
  private _consumed = false;
  /** The stream that {@link stream} or {@link binaryStream} returns, if one
   *  of them was called. */
  private rowStream: RowsTransform | undefined;
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
  /** `false` after {@link rawStream}, which does not count the bytes. */
  private span_bytes_counted = true;
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

  /** Record the final response metrics (`clickhouse.response.decoded_bytes`
   *  and, when rows were counted, `db.response.returned_rows`) and the error
   *  (if any) on the span, and end it. Safe to call multiple times - only
   *  the first call wins. */
  private finishSpan(err?: unknown): void {
    if (!this.span || this.span_finished) {
      return;
    }
    this.span_finished = true;
    const attributes: ClickHouseSpanAttributes = {};
    if (this.span_bytes_counted) {
      attributes["clickhouse.response.decoded_bytes"] = this.span_bytes;
    }
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
      this.span_bytes += Buffer.byteLength(text);
      this.finishSpan();
      return text;
    } catch (err) {
      this.finishSpan(err);
      throw err;
    }
  }

  /** See {@link BaseResultSet.json}. */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const result: T[] = [];
      // Using the stream() instead of _stream directly to leverage the existing logic
      // for handling incomplete chunks and exception tags.
      // The span progress is updated and the span is finished by the stream() pipeline.
      // TODO: consider using stream() for all formats to unify the logic and error handling.
      const stream = this.stream<T>();
      for await (const rows of stream) {
        for (const row of rows) {
          result.push(row.json() as T);
        }
      }
      return result as ResultJSONType<T, Format>;
    }
    // JSON, JSONObjectEachRow, etc.
    if (isNotStreamableJSONFamily(this.format as DataFormat)) {
      const stream = this.consume();
      try {
        const text = await getAsText(stream);
        this.span_bytes += Buffer.byteLength(text);
        const parsed = this.jsonHandling.parse<ResultJSONType<T, Format>>(text);
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
    // The bytes from the start of a row up to a `\r\n` that can open a
    // mid-stream exception block, when the chunk ends before it is possible to
    // decide. The first bytes of the next chunk decide.
    let undecidedBytes: Buffer | undefined;
    // A mid-stream exception block, collected until it is complete.
    let exceptionBlock: Buffer | undefined;
    const logError = this.log_error;
    const exceptionTag = this.exceptionTag;
    const jsonHandling = this.jsonHandling;
    const toRow = (bytes: Buffer): Row => {
      const text = bytes.toString();
      return {
        text,
        json<T>(): T {
          return jsonHandling.parse(text);
        },
      };
    };
    const detectJSONError = createJSONEachRowErrorDetector(this.format);
    const isJSONFormat = isStreamableJSONFamily(this.format as DataFormat);
    const source = this.consume();
    // Completes a transform step, with the server error if there is one.
    // After an error, the rest of the response is not read: the server
    // aborts the connection after the error, so the source is detached and
    // destroyed. The rows before the error stay in the buffer of `toRows`
    // until the consumer reads them; then `toRows` fails with the error.
    const callbackAfterRows = (
      callback: TransformCallback,
      error: Error | undefined,
    ) => {
      if (error === undefined) {
        return callback();
      }
      failAfterRows(error);
      callback();
    };
    // The error that `failAfterRows` logged and recorded on the span.
    let reportedError: Error | undefined;
    const failAfterRows = (error: Error) => {
      source.unpipe(toRows);
      source.destroy();
      // `toRows` is destroyed when `close()` came first, for example from a
      // 'data' listener that `push` called: the consumer does not get the
      // error, so it is not reported.
      if (!toRows.failed && !toRows.destroyed) {
        // Log the error and end the span now: the consumer can stop before
        // it reads the rows before the error, and then `toRows` never fails.
        reportedError = error;
        logError(error);
        resultSet.finishSpan(error);
      }
      toRows.failAfterRows(error);
    };
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const resultSet = this;
    const toRows = new RowsTransform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        if (toRows.failed) {
          // A chunk that was buffered before the error. Ignore it.
          return callback();
        }
        resultSet.span_bytes += chunk.length;

        if (exceptionBlock !== undefined && exceptionTag !== undefined) {
          exceptionBlock = Buffer.concat([exceptionBlock, chunk]);
          return callbackAfterRows(
            callback,
            errorFromExceptionBlock(exceptionBlock, exceptionTag),
          );
        }
        const rows: Row[] = [];

        if (undecidedBytes !== undefined && exceptionTag !== undefined) {
          // The kept bytes are a row, its `\r\n`, and the start of a possible
          // exception block opening. Decide with the first bytes of the chunk.
          const rowEnd = undecidedBytes.indexOf(NEWLINE);
          const afterRow = undecidedBytes.subarray(rowEnd + 1);
          if (
            afterRow.indexOf(NEWLINE) === -1 &&
            matchExceptionBlockStart(
              chunk,
              0,
              exceptionTag,
              afterRow.length,
            ) === "none"
          ) {
            // Not an exception block: the kept row is complete, and the bytes
            // after it start the next row. Scan the chunk without a copy.
            rows.push(toRow(undecidedBytes.subarray(0, rowEnd)));
            if (afterRow.length > 0) {
              incompleteChunks.push(afterRow);
            }
          } else {
            chunk = Buffer.concat([undecidedBytes, chunk]);
          }
          undecidedBytes = undefined;
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
            // Check for a mid-stream exception block (only after 25.11). The
            // `\r`-before-`\n` test is a cheap pre-filter; the block is only
            // confirmed by its opening marker and the random tag, so a stray
            // `\r\n` in a successful response body (binary Parquet, CRLF
            // CSV/TSV rows) is not a false positive. The block can be split
            // across chunks: it is collected until it is complete, and its
            // bytes are never emitted as rows.
            if (
              exceptionTag !== undefined &&
              (idx > 0 ? chunk[idx - 1] : lastByte(incompleteChunks)) ===
                CARET_RETURN
            ) {
              const match = matchExceptionBlockStart(
                chunk,
                idx + 1,
                exceptionTag,
              );
              if (match !== "none") {
                if (rows.length > 0) {
                  resultSet.addSpanRows(rows.length);
                  this.push(rows);
                }
                if (match === "partial") {
                  incompleteChunks.push(chunk.subarray(lastIdx));
                  undecidedBytes = Buffer.concat(incompleteChunks);
                  incompleteChunks.length = 0;
                  return callback();
                }
                // The rest of the response is the exception block. A row that
                // is cut by it, if any, is incomplete and is dropped.
                incompleteChunks.length = 0;
                exceptionBlock = chunk.subarray(idx + 1);
                return callbackAfterRows(
                  callback,
                  errorFromExceptionBlock(exceptionBlock, exceptionTag),
                );
              }
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

            const row = toRow(currentChunkPart);
            const error = detectJSONError?.(row.text);
            if (error) {
              if (rows.length > 0) {
                resultSet.addSpanRows(rows.length);
                this.push(rows);
              }
              return callbackAfterRows(callback, error);
            }
            rows.push(row);
            lastIdx = idx + 1; // skipping newline character
          }
        }
        callback();
      },
      flush(callback: TransformCallback) {
        // With an error, the callback is not called: it would end the
        // readable side before the stream fails.
        if (toRows.failed) {
          return;
        }
        if (exceptionBlock !== undefined && exceptionTag !== undefined) {
          const error = errorFromExceptionBlock(
            exceptionBlock,
            exceptionTag,
            true,
          );
          return error === undefined ? callback() : failAfterRows(error);
        }
        if (undecidedBytes !== undefined) {
          // The bytes are a row, its `\r\n`, and the start of a possible
          // exception block opening (see `matchExceptionBlockStart`).
          const rows: Row[] = [];
          if (sourceError === undefined) {
            // The response ended before these bytes could complete an
            // exception block opening. Without the tag, they cannot be told
            // from data, so they are rows (e.g. the end of a CRLF-terminated
            // CSV/TSV response).
            let lastIdx = 0;
            while (true) {
              const idx = undecidedBytes.indexOf(NEWLINE, lastIdx);
              if (idx === -1) {
                // The bytes after the last newline are not a complete row.
                // They are dropped, the same as `incompleteChunks` at the end.
                break;
              }
              rows.push(toRow(undecidedBytes.subarray(lastIdx, idx)));
              lastIdx = idx + 1;
            }
          } else {
            // A network error cut the response here, so the bytes can be
            // cut data or a cut exception block opening: no rule can tell
            // every case. The bytes after the `\r\n` are dropped (they are
            // an incomplete row, or the marker). The row before it is kept:
            // it is a complete CRLF row. Except: in JSON formats, a row never
            // ends with `\r`; and an empty row followed by marker bytes is
            // the opening after a complete row.
            const rowEnd = undecidedBytes.indexOf(NEWLINE);
            const hasMarkerBytes = rowEnd + 1 < undecidedBytes.length;
            const isEmptyRow = rowEnd === 1; // only the `\r`
            if (!isJSONFormat && !(isEmptyRow && hasMarkerBytes)) {
              rows.push(toRow(undecidedBytes.subarray(0, rowEnd)));
            }
          }
          if (rows.length > 0) {
            resultSet.addSpanRows(rows.length);
            this.push(rows);
          }
        }
        if (detectJSONError !== undefined && incompleteChunks.length > 0) {
          // An error row is the last row, and the server can end the
          // response without a newline after it.
          const error = detectJSONError(
            Buffer.concat(incompleteChunks).toString(),
          );
          if (error !== undefined) {
            return failAfterRows(error);
          }
        }
        if (sourceError !== undefined) {
          return failAfterRows(sourceError);
        }
        callback();
      },
      autoDestroy: true,
      objectMode: true,
    });

    // Not `Stream.pipeline`: it destroys `toRows` when the source fails, and
    // a destroyed stream discards the rows in its buffer. The server aborts
    // the connection after a mid-stream error. With a slow consumer, the
    // chunk with the error can still be in the write buffer of `toRows` at
    // that time. Thus, `toRows` first processes the chunks that it has, and
    // fails with the server error, if it finds one, or with the source error.
    let sourceError: Error | undefined;
    // `finished` also reports a source that is already destroyed, and a
    // source that closes with no error (`ERR_STREAM_PREMATURE_CLOSE`).
    // It calls back in the 'error' event, while the source has its buffer.
    Stream.finished(source, { writable: false }, (err) => {
      if (!err || toRows.failed || toRows.writableEnded) {
        return;
      }
      if (err.name === "AbortError" || err.message === resultSetClosedMessage) {
        // The caller stopped the query: do not give more rows.
        toRows.destroy(err);
        return;
      }
      sourceError = err;
      source.unpipe(toRows);
      // A destroyed stream discards its buffer, but still has it when it
      // emits 'error'. With a slow consumer, the buffer holds the end of the
      // response, with the server error.
      for (let chunk = source.read(); chunk !== null; chunk = source.read()) {
        toRows.write(chunk);
      }
      toRows.end();
    });
    // Releases the socket when the consumer stops before the end.
    toRows.on("close", () => source.destroy());
    Stream.finished(toRows, { readable: false }, (err) => {
      if (
        err &&
        err !== reportedError &&
        err.name !== "AbortError" &&
        err.message !== resultSetClosedMessage
      ) {
        logError(err);
        resultSet.finishSpan(err);
      } else {
        resultSet.finishSpan();
      }
    });
    source.pipe(toRows);
    this.rowStream = toRows;
    return toRows as any;
  }

  /** See {@link BaseResultSet.binaryStream}. */
  binaryStream(): StreamReadable<Buffer> {
    const logError = this.log_error;
    const scanner =
      this.exceptionTag !== undefined && this.exceptionTag.length > 0
        ? new BinaryExceptionScanner(this.exceptionTag)
        : undefined;
    const source = this.consume();
    // The same error handling as in `stream()`: after an error, the source is
    // destroyed, and the bytes before the error stay in the buffer of `toBytes`
    // until the consumer reads them; then `toBytes` fails with the error.
    let reportedError: Error | undefined;
    const fail = (error: Error) => {
      source.unpipe(toBytes);
      source.destroy();
      if (!toBytes.failed && !toBytes.destroyed) {
        reportedError = error;
        logError(error);
        resultSet.finishSpan(error);
      }
      toBytes.failAfterRows(error);
    };
    const pushBytes = (bytes: Uint8Array) => {
      if (bytes.length > 0) {
        toBytes.push(
          Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        );
      }
    };
    let sourceError: Error | undefined;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const resultSet = this;
    const toBytes = new RowsTransform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        if (toBytes.failed) {
          return callback();
        }
        resultSet.span_bytes += chunk.length;
        if (scanner === undefined) {
          return callback(null, chunk);
        }
        const { data, error } = scanner.push(chunk);
        pushBytes(data);
        if (error !== undefined) {
          fail(error);
        }
        callback();
      },
      flush(callback: TransformCallback) {
        // With an error, the callback is not called: it would end the
        // readable side before the stream fails.
        if (toBytes.failed) {
          return;
        }
        if (scanner !== undefined) {
          const { data, error } = scanner.end();
          pushBytes(data);
          if (error !== undefined) {
            return fail(error);
          }
        }
        if (sourceError !== undefined) {
          return fail(sourceError);
        }
        callback();
      },
      autoDestroy: true,
    });
    // See `stream()`: the server closes the connection after a mid-stream
    // error, so the source fails. `toBytes` first scans the chunks that are
    // still in the buffer of the source, because they can hold the error.
    Stream.finished(source, { writable: false }, (err) => {
      if (!err || toBytes.failed || toBytes.writableEnded) {
        return;
      }
      if (err.name === "AbortError" || err.message === resultSetClosedMessage) {
        toBytes.destroy(err);
        return;
      }
      sourceError = err;
      source.unpipe(toBytes);
      for (let chunk = source.read(); chunk !== null; chunk = source.read()) {
        toBytes.write(chunk);
      }
      toBytes.end();
    });
    toBytes.on("close", () => source.destroy());
    Stream.finished(toBytes, { readable: false }, (err) => {
      if (
        err &&
        err !== reportedError &&
        err.name !== "AbortError" &&
        err.message !== resultSetClosedMessage
      ) {
        logError(err);
        resultSet.finishSpan(err);
      } else {
        resultSet.finishSpan();
      }
    });
    source.pipe(toBytes);
    this.rowStream = toBytes;
    return toBytes as any;
  }

  /** See {@link BaseResultSet.rawStream}. */
  rawStream(): Stream.Readable {
    const source = this.consume();
    // The bytes are not counted: a 'data' listener would change how the
    // caller reads the stream.
    this.span_bytes_counted = false;
    Stream.finished(source, (err) => this.finishSpan(err ?? undefined));
    return source;
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
    // After a mid-stream error, the source is already destroyed, but the
    // stream of rows can still have rows and the pending error.
    if (this.rowStream !== undefined && !this.rowStream.destroyed) {
      this.rowStream.destroy(new Error(resultSetClosedMessage));
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

/**
 * A `Transform` that fails with a mid-stream error only after the consumer
 * reads the rows in its buffer. A destroyed stream discards its buffer, so
 * `callback(err)` in `transform` drops the rows that the consumer has not
 * read yet, for example when the consumer is slower than the network.
 */
class RowsTransform extends Transform {
  private pendingError: Error | undefined;

  /** `true` after {@link failAfterRows}. */
  get failed(): boolean {
    return this.pendingError !== undefined;
  }

  /** Fails the stream with `error` when its buffer is empty. The first error
   *  is kept. */
  failAfterRows(error: Error): void {
    this.pendingError ??= error;
    this.failIfRead();
  }

  // All the read paths (`for await`, `'data'`, `'readable'` with `read()`,
  // `pipe`) call `read()`. When it returns the last rows, the stream fails
  // after the caller gets them: a caller that reads once for each
  // 'readable' event does not call `read()` again.
  override read(size?: number) {
    const result = super.read(size);
    if (this.pendingError !== undefined && this.readableLength === 0) {
      if (result === null) {
        this.failIfRead();
      } else {
        process.nextTick(() => this.failIfRead());
      }
    }
    return result;
  }

  private failIfRead(): void {
    if (
      this.pendingError !== undefined &&
      this.readableLength === 0 &&
      !this.destroyed
    ) {
      this.destroy(this.pendingError);
    }
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
