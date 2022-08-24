import Stream from 'stream'
import split from 'split2'

import { getAsText } from './utils'
import { type DataFormat, decode, validateStreamFormat } from './data_formatter'

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
   */
  json<T>(): T {
    return decode(this.text(), this.format)
  }
}

export class Rows {
  constructor(
    private readonly stream: Stream.Readable,
    private readonly format: DataFormat
  ) {}
  /**
   * The method waits for all the rows to be fully loaded and returns the result as a string.
   */
  async text() {
    return (await getAsText(this.stream)).toString()
  }

  /**
   * The method waits for the all the rows to be fully loaded.
   * When the response is received in full, it will be decoded to return JSON.
   */
  async json<T = { data: unknown[] }>(): Promise<T> {
    return decode(await this.text(), this.format)
  }

  /**
   * Returns a readable stream of {@link Row}s for responses in {@link StreamableDataFormat} format.
   * The method will throw if called on a response in non-streamable format.
   */
  asStream(): Stream.Readable {
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
