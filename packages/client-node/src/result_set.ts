import type {
  BaseResultSet,
  DataFormat,
  ResponseHeaders,
  ResultJSONType,
  ResultStream,
  Row,
} from '@clickhouse/client-common'
import {
  ClickHouseError,
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

/** {@link Stream.Readable} with additional types for the `on(data)` method and the async iterator.
 * Everything else is an exact copy from stream.d.ts */
export type StreamReadable<T> = Omit<Stream.Readable, 'on'> & {
  [Symbol.asyncIterator](): AsyncIterableIterator<T>
  on(event: 'data', listener: (chunk: T) => void): Stream.Readable
  on(event: 'close', listener: () => void): Stream.Readable
  on(event: 'drain', listener: () => void): Stream.Readable
  on(event: 'end', listener: () => void): Stream.Readable
  on(event: 'error', listener: (err: Error) => void): Stream.Readable
  on(event: 'finish', listener: () => void): Stream.Readable
  on(event: 'pause', listener: () => void): Stream.Readable
  on(event: 'pipe', listener: (src: Readable) => void): Stream.Readable
  on(event: 'readable', listener: () => void): Stream.Readable
  on(event: 'resume', listener: () => void): Stream.Readable
  on(event: 'unpipe', listener: (src: Readable) => void): Stream.Readable
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
  public readonly response_headers: ResponseHeaders
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
    this.response_headers =
      _response_headers !== undefined ? Object.freeze(_response_headers) : {}
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
    let errorRowText: string | undefined
    const logError = this.log_error
    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback,
      ) {
        const rows: Row[] = []
        let lastIdx = 0
        // first pass on the current chunk
        // using the incomplete row from the previous chunks
        let idx = chunk.indexOf(NEWLINE)
        if (idx !== -1) {
          let text: string
          if (incompleteChunks.length > 0) {
            text = Buffer.concat(
              [...incompleteChunks, chunk.subarray(0, idx)],
              incompleteChunks.reduce((sz, buf) => sz + buf.length, 0) + idx,
            ).toString()
            incompleteChunks = []
          } else {
            text = chunk.subarray(0, idx).toString()
          }
          rows.push({
            text,
            json<T>(): T {
              return JSON.parse(text)
            },
          })
          lastIdx = idx + 1 // skipping newline character
          // consequent passes on the current chunk with at least one row parsed
          // all previous chunks with incomplete rows were already processed
          do {
            idx = chunk.indexOf(NEWLINE, lastIdx)
            if (idx !== -1) {
              const text = chunk.subarray(lastIdx, idx).toString()
              rows.push({
                text,
                json<T>(): T {
                  return JSON.parse(text)
                },
              })
            } else {
              // to be processed during the first pass for the next chunk
              incompleteChunks.push(chunk.subarray(lastIdx))
              // error reporting goes like this:
              // __exception__\r\n              // - the row before the last one
              // Code: X. DB::Exception: ...\n  // - the very last row
              // we are not going to push these rows downstream
              if (
                rows.length > 1 &&
                rows[rows.length - 2].text === errorHeaderMessage
              ) {
                errorRowText = rows[rows.length - 1].text
                // push the remaining rows before the error
                if (rows.length > 2) {
                  this.push(rows.slice(0, -2))
                }
              } else {
                this.push(rows)
              }
            }
            lastIdx = idx + 1 // skipping newline character
          } while (idx !== -1)
        } else {
          incompleteChunks.push(chunk) // this chunk does not contain a full row
        }
        callback()
      },
      // will be triggered if ClickHouse terminates the connection with an error while streaming
      destroy(err: Error | null, callback: (error?: Error | null) => void) {
        if (errorRowText !== undefined) {
          const maybeLastRowErr = parseError(errorRowText)
          if (maybeLastRowErr instanceof ClickHouseError) {
            callback(maybeLastRowErr)
          }
        } else if (err !== null) {
          callback(err)
        } else {
          callback()
        }
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
const errorHeaderMessage = `__exception__\r`
