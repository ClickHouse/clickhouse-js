import type { BaseResultSet, DataFormat, Row } from '@clickhouse/client-common'
import { decode, validateStreamFormat } from '@clickhouse/client-common'
import { Buffer } from 'buffer'
import type { TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'
import { getAsText } from './utils'

const NEWLINE = 0x0a as const

export class ResultSet implements BaseResultSet<Stream.Readable> {
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat,
    public readonly query_id: string,
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

    let incompleteChunks: Buffer[] = []
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
              this.push(rows)
            }
            lastIdx = idx + 1 // skipping newline character
          } while (idx !== -1)
        } else {
          incompleteChunks.push(chunk) // this chunk does not contain a full row
        }
        callback()
      },
      autoDestroy: true,
      objectMode: true,
    })

    return Stream.pipeline(this._stream, toRows, function pipelineCb(err) {
      if (err) {
        // FIXME: use logger instead
        // eslint-disable-next-line no-console
        console.error(err)
      }
    })
  }

  close() {
    this._stream.destroy()
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
