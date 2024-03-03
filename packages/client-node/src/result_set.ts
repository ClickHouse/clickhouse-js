/* eslint-disable no-console */
import type { BaseResultSet, DataFormat, Row } from '@clickhouse/client-common'
import { decode, validateStreamFormat } from '@clickhouse/client-common'
import { DecodedColumns, RowBinaryColumns } from '@clickhouse/client-common/src/data_formatter'
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

  async get(): Promise<unknown[][]> {
    if (this.format !== 'RowBinary') {
      throw new Error(
        `Can't use RowBinaryResultSet if the format is not RowBinary`
      )
    }
    const result: unknown[][] = []
    await new Promise((resolve, reject) => {
      this.stream()
        .on('data', (rows: unknown[][]) => {
          result.push(...rows)
        })
        .on('end', resolve)
        .on('error', reject)
    })
    return result
  }

  stream(): Stream.Readable {
    // If the underlying stream has already ended,
    // Stream.pipeline will create a new empty stream,
    // but without "readableEnded" flag set to true
    if (this._stream.readableEnded) {
      throw Error(streamAlreadyConsumedMessage)
    }
    if (this.format !== 'RowBinary') {
      throw new Error(
        `Can't use RowBinaryResultSet if the format is not RowBinary`
      )
    }

    let loc = 0
    let columns: DecodedColumns[0] | undefined
    let incompleteChunk: Uint8Array | undefined
    let row: unknown[] = []
    let lastColumnIdx: number | undefined

    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        // console.log(`got a new chunk, len: ${chunk.length}`)
        let src: Uint8Array
        if (incompleteChunk !== undefined) {
          // console.log('got an incomplete chunk', incompleteChunk.length)
          src = Buffer.concat([incompleteChunk, chunk.subarray()])
          incompleteChunk = undefined
        } else {
          //console.log('no incomplete chunk')
          src = chunk.subarray()
        }
        if (columns === undefined) {
          const res = RowBinaryColumns.decode(src)
          if ('error' in res) {
            callback(new Error(res.error))
            return
          }
          columns = res[0]
          loc = res[1]
          //console.log(`Columns ${columns.names} with types ${columns.types}. Next loc after columns: ${loc}`)
        }
        let decodeResult: [unknown, number] | null
        const rows: unknown[][] = []
        // an incomplete row from the previous chunk; continue from the known column index
        if (lastColumnIdx !== undefined) {
          // console.log('incomplete idx:', lastColumnIdx)
          for (let i = lastColumnIdx; i < columns.decoders.length; i++) {
            // FIXME - handle null properly; currently assuming that the second chunk will be enough (but it maybe not be)
            decodeResult = columns.decoders[i](src, loc)
            if (decodeResult === null) {
              callback(new Error('Not enough data to decode the row'))
              return
            } else {
              // console.log(
              //   `Decoded incomplete column ${columns.names[i]} at loc ${loc} with result ${decodeResult}`
              // )
              row[i] = decodeResult[0]
              loc = decodeResult[1]
            }
          }
          // console.log('incomplete push:', row)
          rows.push(row)
          lastColumnIdx = undefined
        }
        // done with the previous incomplete rows; processing the rows as normal
        // console.log('loc and src len', loc, src.length)
        while (loc <= src.length) {
          row = new Array(columns.names.length)
          for (let i = 0; i < columns.decoders.length; i++) {
            decodeResult = columns.decoders[i](src, loc)
            // console.log(
            //   `Decoded column ${columns.names[i]} at loc ${loc} with result ${decodeResult}`
            // )
            // maybe not enough data to finish the row
            if (decodeResult === null) {
              // console.log(
              //   `Decode result is null for column ${columns?.names[i]}`
              // )
              // keep the remaining data to add to the next chunk
              incompleteChunk = src.subarray(loc)
              loc = 0
              lastColumnIdx = i
              if (rows.length > 0) {
                this.push(rows)
              }
              callback()
              return
            } else {
              if (String(decodeResult[0]).length > 100) {
                throw new Error('foo')
              }
              // decoded a value
              row[i] = decodeResult[0]
              loc = decodeResult[1]
              if (loc > src.length) {
                loc = loc - src.length
                incompleteChunk = src.subarray(loc)
                // if there are more columns to decode, keep the index
                if (i < columns.decoders.length - 1) {
                  lastColumnIdx = i
                } else {
                  rows.push(row)
                }
                if (rows.length > 0) {
                  this.push(rows)
                }
                callback()
                return
              }
            }
          }
          // console.log('complete push, maybe there is more:', row)
          rows.push(row)
        }
        if (rows.length > 0) {
          this.push(rows)
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
