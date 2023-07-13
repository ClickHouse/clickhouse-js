import type { TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'
import type { DataFormat } from '@clickhouse/client-common/data_formatter'
import {
  decode,
  validateStreamFormat,
} from '@clickhouse/client-common/data_formatter'
import type { IResultSet, Row } from '@clickhouse/client-common'
import { getAsText } from './utils'

export class ResultSet implements IResultSet<Stream.Readable> {
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat,
    public readonly query_id: string
  ) {}

  async text(): Promise<string> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return (await getAsText(this._stream)).toString()
  }

  async json<T>(): Promise<T> {
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    return decode(await this.text(), this.format)
  }

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

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
