import type { BaseResultSet, DataFormat } from '@clickhouse/client-common'
import type { DecodedColumns } from '@clickhouse/client-common/src/data_formatter'
import { RowBinaryColumns } from '@clickhouse/client-common/src/data_formatter'
import { Buffer } from 'buffer'
import Stream, { Transform, type TransformCallback } from 'stream'

// draft; currently unused.
export interface RowBinaryMappers {
  date?: <T>(daysSinceEpochUInt16: number) => T
  date32?: <T>(daysSinceEpochInt32: number) => T
  datetime?: <T>(secondsSinceEpochUInt32: number, timezone?: string) => T
  datetime64?: <T>(seconds: bigint, nanos: number, timezone?: string) => T
  decimal?: <T>(whole: number | bigint, fractional: number | bigint) => T
}
export interface RowBinaryResultSetOptions {
  mappers?: RowBinaryMappers
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
          for (let i = 0; i < rows.length; i++) {
            result.push(rows[i])
          }
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
      throw Error('Stream has been already consumed')
    }
    if (this.format !== 'RowBinary') {
      throw Error(`Format ${this.format} is not RowBinary`)
    }

    let columns: DecodedColumns[0] | undefined
    let incompleteChunk: Uint8Array | undefined
    let columnIndex = 0
    const rowsToPush: unknown[][] = []

    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        //console.log(`transform call, chunk length: ${chunk.length}`)
        let src: Buffer
        if (incompleteChunk !== undefined) {
          src = Buffer.concat([incompleteChunk, chunk.subarray()])
          incompleteChunk = undefined
        } else {
          src = chunk.subarray()
        }

        let loc = 0
        if (columns === undefined) {
          const res = RowBinaryColumns.decode(src)
          if ('error' in res) {
            return callback(new Error(res.error))
          }
          columns = res[0]
          loc = res[1]
        }

        while (loc < src.length) {
          const row = new Array(columns.names.length)
          while (columnIndex < columns.names.length) {
            const decodeResult = columns.decoders[columnIndex](src, loc)
            //console.log(decodeResult, loc, src.length, columns?.names[columnIndex], columns?.types[columnIndex])
            // not enough data to finish the row - null indicates that
            if (decodeResult === null) {
              // will be added to the beginning of the next received chunk
              incompleteChunk = src.subarray(loc)
              if (rowsToPush.length > 0) {
                this.push(rowsToPush)
                rowsToPush.length = 0
              }
              return callback()
            } else {
              // decoded a value
              row[columnIndex] = decodeResult[0]
              loc = decodeResult[1]
              columnIndex++
            }
          }
          rowsToPush.push(row)
          columnIndex = 0
        }

        if (loc > src.length) {
          incompleteChunk = src.subarray(loc - src.length)
        }

        if (rowsToPush.length > 0) {
          this.push(rowsToPush)
          rowsToPush.length = 0
        }

        return callback()
      },
      final(callback: TransformCallback) {
        if (rowsToPush.length > 0) {
          this.push(rowsToPush)
          rowsToPush.length = 0
        }
        return callback()
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
