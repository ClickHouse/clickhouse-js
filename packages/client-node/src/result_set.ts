import type {
  BaseResultSet,
  DataFormat,
  JSONHandling,
  ResponseHeaders,
  ResultJSONType,
  ResultStream,
  Row,
} from '@clickhouse/client-common'
import {
  extractErrorAtTheEndOfChunk,
  defaultJSONHandling,
  EXCEPTION_TAG_HEADER_NAME,
  CARET_RETURN,
} from '@clickhouse/client-common'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  validateStreamFormat,
} from '@clickhouse/client-common'
import { Buffer } from 'buffer'
import type { Readable, TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'
import { getAsText } from './utils'
import { ClickHouseExceptionStream } from './utils/exception_stream'

const NEWLINE = 0x0a as const

/** {@link Stream.Readable} with additional types for the `on(data)` method and the async iterator.
 * Everything else is an exact copy from stream.d.ts */
export type StreamReadable<T> = Omit<Stream.Readable, 'on'> & {
  [Symbol.asyncIterator](): NodeJS.AsyncIterator<T>
  on(event: 'data', listener: (chunk: T) => void): Stream.Readable
  on(
    event:
      | 'close'
      | 'drain'
      | 'end'
      | 'finish'
      | 'pause'
      | 'readable'
      | 'resume'
      | 'unpipe',
    listener: () => void,
  ): Stream.Readable
  on(event: 'error', listener: (err: Error) => void): Stream.Readable
  on(event: 'pipe', listener: (src: Readable) => void): Stream.Readable
  on(
    event: string | symbol,
    listener: (...args: any[]) => void,
  ): Stream.Readable
}

export interface ResultSetOptions<Format extends DataFormat> {
  stream: Stream.Readable
  format: Format
  query_id: string
  log_error: (error: Error) => void
  response_headers: ResponseHeaders
  jsonHandling?: JSONHandling
  /**
   * When enabled, an optional {@link ClickHouseExceptionStream} transformer is
   * plugged into the internal stream to parse in-band exception blocks that
   * ClickHouse (25.11+) appends to the response body after a 200 status. Off by
   * default; requires the `X-ClickHouse-Exception-Tag` response header to be
   * present, otherwise the transformer is skipped.
   */
  exceptionStream?: boolean
}

export class ResultSet<
  Format extends DataFormat | unknown,
> implements BaseResultSet<Stream.Readable, Format> {
  public readonly response_headers: ResponseHeaders = {}

  private readonly exceptionTag: string | undefined = undefined
  private readonly log_error: (error: Error) => void
  private readonly jsonHandling: JSONHandling
  private readonly exceptionStream: boolean
  private _consumed = false

  constructor(
    /**
     * The stream of the response body.
     *
     * It is expected that the stream is passed directly from the response of the HTTP request
     * and has not been consumed or altered yet.
     */
    private _stream: Stream.Readable,
    private readonly format: Format,
    public readonly query_id: string,
    log_error?: (error: Error) => void,
    _response_headers?: ResponseHeaders,
    jsonHandling?: JSONHandling,
    exceptionStream?: boolean,
  ) {
    this.jsonHandling = {
      ...defaultJSONHandling,
      ...jsonHandling,
    }
    // eslint-disable-next-line no-console
    this.log_error = log_error ?? ((err: Error) => console.error(err))
    this.exceptionStream = exceptionStream ?? false

    if (_response_headers !== undefined) {
      this.response_headers = Object.freeze(_response_headers)
      this.exceptionTag = _response_headers[EXCEPTION_TAG_HEADER_NAME] as
        | string
        | undefined
    }
  }

  private consume() {
    if (this._consumed) {
      throw new Error(streamAlreadyConsumedMessage)
    }
    this._consumed = true
    return this._stream
  }

  /** See {@link BaseResultSet.text}. */
  async text(): Promise<string> {
    return await getAsText(this.consume())
  }

  /** See {@link BaseResultSet.json}. */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const result: T[] = []
      // Using the stream() instead of _stream directly to leverage the existing logic
      // for handling incomplete chunks and exception tags.
      // TODO: consider using stream() for all formats to unify the logic and error handling.
      const stream = this.stream<T>()
      for await (const rows of stream) {
        for (const row of rows) {
          result.push(row.json() as T)
        }
      }
      return result as ResultJSONType<T, Format>
    }
    // JSON, JSONObjectEachRow, etc.
    if (isNotStreamableJSONFamily(this.format as DataFormat)) {
      const text = await getAsText(this.consume())
      return this.jsonHandling.parse(text)
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} as JSON`)
  }

  /** See {@link BaseResultSet.stream}. */
  stream<T>(): ResultStream<Format, StreamReadable<Row<T, Format>[]>> {
    validateStreamFormat(this.format)

    const incompleteChunks: Buffer[] = []
    const logError = this.log_error
    const exceptionTag = this.exceptionTag
    const jsonHandling = this.jsonHandling
    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        const rows: Row[] = []

        let lastIdx = 0
        let currentChunkPart: Buffer

        while (true) {
          // an unescaped newline character denotes the end of a row,
          // or at least the beginning of the exception marker
          const idx = chunk.indexOf(NEWLINE, lastIdx)
          if (idx === -1) {
            incompleteChunks.push(chunk.subarray(lastIdx))
            if (rows.length > 0) {
              this.push(rows)
            }
            break
          } else {
            // Check for exception in the chunk (only after 25.11)
            if (
              exceptionTag !== undefined &&
              idx >= 1 &&
              chunk[idx - 1] === CARET_RETURN
            ) {
              return callback(extractErrorAtTheEndOfChunk(chunk, exceptionTag))
            }

            if (incompleteChunks.length > 0) {
              incompleteChunks.push(chunk.subarray(lastIdx, idx))
              currentChunkPart = Buffer.concat(incompleteChunks)
              // Removing used buffers and reusing the already allocated memory
              // by setting length to 0
              incompleteChunks.length = 0
            } else {
              currentChunkPart = chunk.subarray(lastIdx, idx)
            }

            const text = currentChunkPart.toString()
            rows.push({
              text,
              json<T>(): T {
                return jsonHandling.parse(text)
              },
            })
            lastIdx = idx + 1 // skipping newline character
          }
        }
        callback()
      },
      autoDestroy: true,
      objectMode: true,
    })

    const source = this.consume()
    const pipelineCb = function pipelineCb(err: NodeJS.ErrnoException | null) {
      if (
        err &&
        err.name !== 'AbortError' &&
        err.message !== resultSetClosedMessage
      ) {
        logError(err)
      }
    }

    // Optionally plug the in-band exception transformer into the internal stream.
    // Only used when explicitly enabled and the server advertised an exception tag.
    const pipeline =
      this.exceptionStream && this.exceptionTag !== undefined
        ? Stream.pipeline(
            source,
            new ClickHouseExceptionStream({ tag: this.exceptionTag }),
            toRows,
            pipelineCb,
          )
        : Stream.pipeline(source, toRows, pipelineCb)
    return pipeline as any
  }

  /** See {@link BaseResultSet.close}. */
  close() {
    this._stream.destroy(new Error(resultSetClosedMessage))
  }

  /**
   * Closes the `ResultSet`.
   *
   * Automatically called when using `using` statement in supported environments.
   * @see {@link ResultSet.close}
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using
   */
  [Symbol.dispose]() {
    this.close()
  }

  static instance<Format extends DataFormat>({
    stream,
    format,
    query_id,
    log_error,
    response_headers,
    jsonHandling,
    exceptionStream,
  }: ResultSetOptions<Format>): ResultSet<Format> {
    return new ResultSet(
      stream,
      format,
      query_id,
      log_error,
      response_headers,
      jsonHandling,
      exceptionStream,
    )
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
const resultSetClosedMessage = 'ResultSet has been closed'
