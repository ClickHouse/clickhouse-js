import type Stream from 'stream'

import { getAsText } from './utils'
import { type DataFormat, decode, validateStreamFormat } from './data_formatter'

export class Rows {
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat
  ) {}

  /**
   * The method waits for all the rows to be fully loaded
   * and returns the result as a string.
   *
   * The method will throw if the underlying stream was already consumed
   * by calling the other methods
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
   * by calling the other methods
   */
  async json<T>(): Promise<T> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return decode(await this.text(), this.format)
  }

  /**
   * Returns an async iterator of {@link Row}s for responses
   * in {@link StreamableDataFormat} format.
   *
   * If selected format is non-streamable,
   * or the underlying stream was already consumed,
   * it will throw when accessing the next element
   */
  async *stream(): AsyncGenerator<Row, void> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    validateStreamFormat(this.format)
    const textDecoder = new TextDecoder()
    let decodedChunk = ''
    for await (const chunk of this._stream) {
      decodedChunk += textDecoder.decode(chunk, { stream: true })
      let idx = 0
      while (true) {
        idx = decodedChunk.indexOf('\n')
        if (idx !== -1) {
          const line = decodedChunk.slice(0, idx)
          decodedChunk = decodedChunk.slice(idx + 1)
          yield {
            /**
             * Returns a string representation of a row.
             */
            text(): string {
              return line
            },

            /**
             * Returns a JSON representation of a row.
             * The method will throw if called on a response in JSON incompatible format.
             *
             * It is safe to call this method multiple times.
             */
            json<T>(): T {
              return decode(line, 'JSON')
            },
          }
        } else {
          break
        }
      }
    }
    textDecoder.decode() // flush
  }

  close() {
    this._stream.destroy()
  }
}

export interface Row {
  text(): string
  json<T>(): T
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
