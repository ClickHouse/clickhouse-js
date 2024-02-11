import type { BaseResultSet, DataFormat, Row } from '@clickhouse/client-common'
import { decode, validateStreamFormat } from '@clickhouse/client-common'
import { RowBinaryDecoder } from '@clickhouse/client-common/src/data_formatter/row_binary'
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

    let incompleteChunks: Buffer[] = []
    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
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
              incompleteChunks.reduce((sz, buf) => sz + buf.length, 0) + idx
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
        console.error(err)
      }
    })
  }

  close() {
    this._stream.destroy()
  }
}

export class RowBinaryResultSet implements BaseResultSet<Stream.Readable> {
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat,
    public readonly query_id: string
  ) {}

  async text(): Promise<string> {
    throw new Error(
      `Can't call 'text()' on RowBinary result set; please use 'stream' instead`
    )
  }

  async json<T>(): Promise<T> {
    throw new Error(
      `Can't call 'json()' on RowBinary result set; please use 'stream' instead`
    )
  }

  stream(): Stream.Readable {
    // If the underlying stream has already ended by calling `text` or `json`,
    // Stream.pipeline will create a new empty stream
    // but without "readableEnded" flag set to true
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    if (this.format !== 'RowBinaryWithNamesAndTypes') {
      throw new Error(
        `Can't use RowBinaryResultSet if the format is not RowBinary`
      )
    }

    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        const src = chunk.subarray()
        const rows: unknown[][] = []
        let res: [unknown, number]
        const colDataRes = RowBinaryDecoder.columns(src)
        const { names, types } = colDataRes[0]
        let loc = colDataRes[1]
        console.log(colDataRes[0])
        console.log(`Next loc: ${loc}`)
        while (loc < src.length) {
          const values = new Array(names.length)
          types.forEach((t, i) => {
            switch (t) {
              case 'Int8':
                res = RowBinaryDecoder.int8(src, loc)
                console.log(`Int8: ${res[0]}, next loc: ${res[1]}`)
                values[i] = res[0]
                loc = res[1]
                break
              case 'String':
                res = RowBinaryDecoder.string(src, loc)
                console.log(`String: ${res[0]}, next loc: ${res[1]}`)
                values[i] = res[0]
                loc = res[1]
                break
              default:
                throw new Error(`Unknown type ${t}`)
            }
          })
          rows.push(values)
        }
        this.push(rows)
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
