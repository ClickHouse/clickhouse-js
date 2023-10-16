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

    let data: Buffer
    let leftovers: Buffer | undefined

    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        // Already allocated, x2 chunk size should be enough for any leftovers
        if (data !== undefined) {
          let chunkOffset
          let currentDataSize
          if (leftovers !== undefined) {
            chunkOffset = leftovers.length
            currentDataSize = chunkOffset + chunk.length
            data.fill(leftovers, 0, chunkOffset)
          } else {
            chunkOffset = 0
            currentDataSize = chunk.length
          }
          data.fill(chunk, chunkOffset, currentDataSize)
          data.fill(0, currentDataSize, data.length)
        } else {
          // First pass, allocate enough memory for the chunk and potential leftovers
          data = Buffer.alloc(chunk.length * 2, 0)
          data.fill(chunk, 0, chunk.length)
        }
        const rows: Row[] = []
        let lastIdx = 0
        do {
          const idx = data.indexOf(NEWLINE, lastIdx === 0 ? 0 : lastIdx + 1)
          if (idx !== -1) {
            const text = data.subarray(lastIdx, idx).toString()
            rows.push({
              text,
              json<T>(): T {
                try {
                  return JSON.parse(text)
                } catch (e) {
                  console.error('Failed with: ', text)
                  throw e
                }
              },
            })
          } else {
            if (rows.length) {
              this.push(rows)
            }
            leftovers = data.subarray(
              lastIdx + 1,
              (leftovers?.length ?? 0) + chunk.length
            ) // +1 to skip newline
          }
          lastIdx = idx
        } while (lastIdx !== -1)
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
