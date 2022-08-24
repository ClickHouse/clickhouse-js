import Stream from 'stream'
import split from 'split2'

import { getAsText } from './utils'
import { type DataFormat, decode, validateStreamFormat } from './data_formatter'

export class Rows {
  constructor(
    private stream: Stream.Readable,
    private readonly format: DataFormat
  ) {}

  /**
   * The method waits for all the rows to be fully loaded
   * and returns the result as a string.
   *
   * The method will throw if the underlying stream was already consumed
   * by calling the other methods
   */
  async text() {
    if (this.stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return (await getAsText(this.stream)).toString()
  }

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   *
   * The method will throw if the underlying stream was already consumed
   * by calling the other methods
   */
  async json<T = { data: unknown[] }>(): Promise<T> {
    if (this.stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return decode(await this.text(), this.format)
  }

  /**
   * Returns a readable stream of {@link Row}s for responses
   * in {@link StreamableDataFormat} format.
   *
   * The method will throw if called on a response in non-streamable format,
   * and if the underlying stream was already consumed
   * by calling the other methods
   */
  asStream(): Stream.Readable {
    // If the underlying stream has already ended by calling `text` or `json`,
    // Stream.pipeline will create a new empty stream
    // but without "readableEnded" flag set to true
    if (this.stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }

    validateStreamFormat(this.format)

    return Stream.pipeline(
      this.stream,
      // only JSON-based format are supported at the moment
      split((row: string) => new Row(row, 'JSON')),
      function pipelineCb(err) {
        if (err) {
          console.error(err)
        }
      }
    )
  }

  close() {
    this.stream.destroy()
  }
}

export class Row {
  constructor(
    private readonly chunk: string,
    private readonly format: DataFormat
  ) {}

  /**
   * Returns a string representation of a row.
   */
  text() {
    return this.chunk
  }

  /**
   * Returns a JSON representation of a row.
   * The method will throw if called on a response in JSON incompatible format.
   *
   * It is safe to call this method multiple times.
   */
  json<T>(): T {
    return decode(this.text(), this.format)
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
