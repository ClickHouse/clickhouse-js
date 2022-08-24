import Stream from 'stream'
import split from 'split2'

import { getAsText } from './utils'
import { type DataFormat, decode, validateStreamFormat } from './data_formatter'

export class Rows {
  private _text: string | undefined
  private _json: unknown | undefined
  constructor(
    private readonly stream: Stream.Readable,
    private readonly format: DataFormat
  ) {}

  /**
   * The method waits for all the rows to be fully loaded
   * and returns the result as a string.
   * The result is cached, so it's safe to call the method multiple times
   */
  async text() {
    if (this._text === undefined) {
      this._text = (await getAsText(this.stream)).toString()
    }
    return this._text
  }

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   * The result is cached, so it's safe to call the method multiple times
   */
  async json<T = { data: unknown[] }>(): Promise<T> {
    if (this._json === undefined) {
      this._json = decode(await this.text(), this.format)
    }
    return this._json as T
  }

  /**
   * Returns a readable stream of {@link Row}s for responses
   * in {@link StreamableDataFormat} format.
   * The method will throw if called on a response in non-streamable format.
   */
  asStream(): Stream.Readable {
    // If the underlying stream has already ended by calling `text` or `json`,
    // Stream.pipeline will create a new empty stream
    // but without "readableEnded" flag set to true
    if (this.stream.readableEnded) {
      return this.stream
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
  private _json: unknown | undefined
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
   */
  json<T>(): T {
    if (this._json === undefined) {
      this._json = decode(this.text(), this.format)
    }
    return this._json as T
  }
}
