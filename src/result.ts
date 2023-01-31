import type { TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'

import { getAsText } from './utils'
import { type DataFormat, decode, validateStreamFormat } from './data_formatter'

export class ResultSet {
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat,
    public readonly query_id: string
  ) {}

  /**
   * The method waits for all the rows to be fully loaded
   * and returns the result as a string.
   *
   * The method will throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  async text(): Promise<string> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return (await getAsText(this._stream)).toString()
  }

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   *
   * The method will throw if the underlying stream was already consumed
   * by calling the other methods.
   */
  async json<T>(): Promise<T> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return decode(await this.text(), this.format)
  }

  /**
   * Returns a readable stream for responses that can be streamed
   * (i.e. all except JSON).
   *
   * Every iteration provides an array of {@link Row} instances
   * for {@link StreamableDataFormat} format.
   *
   * Should be called only once.
   *
   * The method will throw if called on a response in non-streamable format,
   * and if the underlying stream was already consumed
   * by calling the other methods.
   */
  stream(): Stream.Readable {
    // If the underlying stream has already ended by calling `text` or `json`,
    // Stream.pipeline will create a new empty stream
    // but without "readableEnded" flag set to true
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }

    validateStreamFormat(this.format)

    let decodedChunk = ''
    const toRows = new Transform({
      transform(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        decodedChunk += chunk.toString()
        const rows: Row[] = []
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const idx = decodedChunk.indexOf('\n')
          if (idx !== -1) {
            const text = decodedChunk.slice(0, idx)
            decodedChunk = decodedChunk.slice(idx + 1)
            rows.push({
              text,
              json<T>(): T {
                return decode(text, 'JSON')
              },
            })
          } else {
            if (rows.length) {
              this.push(rows)
            }
            break
          }
        }
        callback()
      },
      autoDestroy: true,
      objectMode: true,
    })

    return Stream.pipeline(this._stream, toRows, function pipelineCb(err) {
      if (err) {
        console.error(err)
      }
    })
  }

  close() {
    this._stream.destroy()
  }
}

export interface Row {
  /**
   * A string representation of a row.
   */
  text: string

  /**
   * Returns a JSON representation of a row.
   * The method will throw if called on a response in JSON incompatible format.
   * It is safe to call this method multiple times.
   */
  json<T>(): T
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
