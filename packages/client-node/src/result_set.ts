import type {
  BaseResultSet,
  DataFormat,
  ResponseHeaders,
  ResultJSONType,
  ResultStream,
  Row,
} from '@clickhouse/client-common'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  parseError,
  validateStreamFormat,
} from '@clickhouse/client-common'
import { Buffer } from 'buffer'
import type { Readable, TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'
import { getAsText } from './utils'

const NEWLINE = 0x0a as const
const CARET_RETURN = 0x0d as const

const EXCEPTION_TAG_HEADER = 'x-clickhouse-exception-tag'
const EXCEPTION_MARKER = '__exception__'

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
}

export class ResultSet<Format extends DataFormat | unknown>
  implements BaseResultSet<Stream.Readable, Format>
{
  public readonly response_headers: ResponseHeaders = {}

  private readonly exceptionTag: string | undefined = undefined
  private readonly log_error: (error: Error) => void

  constructor(
    private _stream: Stream.Readable,
    private readonly format: Format,
    public readonly query_id: string,
    log_error?: (error: Error) => void,
    _response_headers?: ResponseHeaders,
  ) {
    // eslint-disable-next-line no-console
    this.log_error = log_error ?? ((err: Error) => console.error(err))

    if (_response_headers !== undefined) {
      this.response_headers = Object.freeze(_response_headers)
      this.exceptionTag = _response_headers[EXCEPTION_TAG_HEADER] as
        | string
        | undefined
    }
  }

  /** See {@link BaseResultSet.text}. */
  async text(): Promise<string> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return (await getAsText(this._stream)).toString()
  }

  /** See {@link BaseResultSet.json}. */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const result: T[] = []
      const stream = this.stream<T>()
      for await (const rows of stream) {
        for (const row of rows) {
          result.push(row.json() as T)
        }
      }
      return result as any
    }
    // JSON, JSONObjectEachRow, etc.
    if (isNotStreamableJSONFamily(this.format as DataFormat)) {
      const text = await getAsText(this._stream)
      return JSON.parse(text)
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} as JSON`)
  }

  /** See {@link BaseResultSet.stream}. */
  stream<T>(): ResultStream<Format, StreamReadable<Row<T, Format>[]>> {
    // If the underlying stream has already ended by calling `text` or `json`,
    // Stream.pipeline will create a new empty stream
    // but without "readableEnded" flag set to true
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }

    validateStreamFormat(this.format)

    let incompleteChunks: Buffer[] = []
    const logError = this.log_error
    const exceptionMarker = this.exceptionTag
    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        console.log('Got chunk:', chunk.toString())

        const rows: Row[] = []

        let idx = -1
        let lastIdx = 0

        do {
          let text: string
          idx = chunk.indexOf(NEWLINE, lastIdx)

          if (
            idx > 0 &&
            chunk[idx - 1] === CARET_RETURN &&
            exceptionMarker !== undefined
          ) {
            // See https://github.com/ClickHouse/ClickHouse/pull/88818
            /**
             * \r\n__exception__\r\nPU1FNUFH98
             * Big bam accrued right while reading the data
             * 45 PU1FNUFH98\r\n__exception__\r\n
             */
            const bytesAfterExceptionLength =
              1 + // space
              EXCEPTION_MARKER.length + // __exception__
              2 + // \r\n
              exceptionMarker.length + // <marker>
              2 // \r\n

            let lenStartIdx = chunk.length - bytesAfterExceptionLength
            do {
              --lenStartIdx
            } while (chunk[lenStartIdx] !== NEWLINE)

            const exceptionLen = +chunk
              .subarray(lenStartIdx, -bytesAfterExceptionLength)
              .toString()

            const exceptionMessage = chunk
              .subarray(lenStartIdx - exceptionLen, lenStartIdx)
              .toString()

            throw parseError(exceptionMessage)
          }

          if (idx !== -1) {
            if (incompleteChunks.length > 0) {
              text = Buffer.concat(
                [...incompleteChunks, chunk.subarray(lastIdx, idx)],
                incompleteChunks.reduce((sz, buf) => sz + buf.length, 0) + idx,
              ).toString()
              incompleteChunks = []
            } else {
              text = chunk.subarray(lastIdx, idx).toString()
            }
            rows.push({
              text,
              json<T>(): T {
                return JSON.parse(text)
              },
            })
            lastIdx = idx + 1 // skipping newline character
          } else {
            incompleteChunks.push(chunk.subarray(lastIdx))
            if (rows.length > 0) {
              this.push(rows)
            }
          }
        } while (idx !== -1)
        callback()
      },
      autoDestroy: true,
      objectMode: true,
    })

    const pipeline = Stream.pipeline(
      this._stream,
      toRows,
      function pipelineCb(err) {
        if (
          err &&
          err.name !== 'AbortError' &&
          err.message !== resultSetClosedMessage
        ) {
          logError(err)
        }
      },
    )
    return pipeline as any
  }

  /** See {@link BaseResultSet.close}. */
  close() {
    this._stream.destroy(new Error(resultSetClosedMessage))
  }

  static instance<Format extends DataFormat>({
    stream,
    format,
    query_id,
    log_error,
    response_headers,
  }: ResultSetOptions<Format>): ResultSet<Format> {
    return new ResultSet(stream, format, query_id, log_error, response_headers)
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
const resultSetClosedMessage = 'ResultSet has been closed'
