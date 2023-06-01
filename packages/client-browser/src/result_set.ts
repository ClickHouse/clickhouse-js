import type { DataFormat, IResultSet } from '@clickhouse/client-common'
import { getAsText } from './utils'
import { decode } from '@clickhouse/client-common/data_formatter'

export class ResultSet implements IResultSet<ReadableStream> {
  private isAlreadyConsumed = false
  constructor(
    private _stream: ReadableStream,
    private readonly format: DataFormat,
    public readonly query_id: string
  ) {}

  close(): void {
    return
  }

  async json<T>(): Promise<T> {
    if (this.isAlreadyConsumed) {
      throw new Error(streamAlreadyConsumedMessage)
    }
    return decode(await this.text(), this.format)
  }

  stream(): ReadableStream {
    this.isAlreadyConsumed = true
    throw new Error('ResultSet.stream not implemented')
  }

  text(): Promise<string> {
    if (this.isAlreadyConsumed) {
      throw new Error(streamAlreadyConsumedMessage)
    }
    return getAsText(this._stream)
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
