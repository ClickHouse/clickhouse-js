import type { BaseResultSet, DataFormat } from '@clickhouse/client-common'
import type { DecodedColumns } from '@clickhouse/client-common/src/data_formatter/row_binary/columns_header'
import { RowBinaryColumnsHeader } from '@clickhouse/client-common/src/data_formatter/row_binary/columns_header'
import { Buffer } from 'buffer'
import Stream, { Transform, type TransformCallback } from 'stream'

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

    const measures: Record<string, number> = {}
    let iterations = 0
    let incompleteChunksTotal = 0
    const NS_PER_SEC = 1e9

    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        //console.log(`transform call, chunk length: ${chunk.length}`)
        let src: Buffer
        if (incompleteChunk !== undefined) {
          incompleteChunksTotal++
          src = Buffer.concat([incompleteChunk, chunk.subarray()])
          incompleteChunk = undefined
        } else {
          src = chunk.subarray()
        }

        let loc = 0
        if (columns === undefined) {
          try {
            const res = RowBinaryColumnsHeader.decode(src)
            columns = res[0]
            loc = res[1]
          } catch (err) {
            return callback(err as Error)
          }
        }
        function logIterationExecutionTime(end: [number, number]) {
          const col = columns!.types[columnIndex]
          const name = columns!.names[columnIndex]
          const execTime = end[0] * NS_PER_SEC + end[1]
          iterations++
          const key = `${col.dbType} - ${name}`
          measures[key] = (measures[key] || 0) + execTime
        }

        while (loc < src.length) {
          const row = new Array(columns.names.length)
          while (columnIndex < columns.names.length) {
            const start = process.hrtime()
            const decodeResult = columns.decoders[columnIndex](src, loc)
            const end = process.hrtime(start)
            logIterationExecutionTime(end)
            //console.log(decodeResult, loc, src.length, columns?.names[columnIndex], columns?.types[columnIndex])
            // not enough data to finish the row - null indicates that
            if (decodeResult === null) {
              // will be added to the beginning of the next received chunk
              incompleteChunk = src.subarray(loc)
              if (rowsToPush.length > 0) {
                // console.log(`pushing ${rowsToPush.length} rows`)
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
          // console.log(`pushing ${rowsToPush.length} rows`)
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
        console.log(`Measures (${iterations})`, measures)
        for (const key in measures) {
          console.log(`Avg ns for ${key}:`, measures[key] / iterations)
        }
        console.log(`Incomplete chunks total:`, incompleteChunksTotal)
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
  //
  // streamDataView() {
  //   // If the underlying stream has already ended,
  //   // Stream.pipeline will create a new empty stream,
  //   // but without "readableEnded" flag set to true
  //   if (this._stream.readableEnded) {
  //     throw Error('Stream has been already consumed')
  //   }
  //   if (this.format !== 'RowBinary') {
  //     throw Error(`Format ${this.format} is not RowBinary`)
  //   }
  //
  //   let columns: { names: string[]; types: ParsedColumnType[]; decoders: SimpleTypeDecoderDataView[] }
  //   let incompleteChunk: Uint8Array | undefined
  //   let columnIndex = 0
  //   const rowsToPush: unknown[][] = []
  //
  //   const toRows = new Transform({
  //     transform(
  //       chunk: Buffer,
  //       _encoding: BufferEncoding,
  //       callback: TransformCallback
  //     ) {
  //       //console.log(`transform call, chunk length: ${chunk.length}`)
  //       let src: DataView
  //       if (incompleteChunk !== undefined) {
  //         const uint8Arr = new Uint8Array(incompleteChunk.length + chunk.length)
  //         uint8Arr.set(incompleteChunk)
  //         uint8Arr.set(chunk, incompleteChunk.length)
  //         src = new DataView(uint8Arr.buffer)
  //         incompleteChunk = undefined
  //       } else {
  //         src = new DataView(chunk.buffer)
  //       }
  //
  //       let loc = 0
  //       if (columns === undefined) {
  //         try {
  //           const res = RowBinaryColumnsHeaderDataView.decode(chunk)
  //           columns = res[0]
  //           loc = res[1]
  //         } catch (err) {
  //           return callback(err as Error)
  //         }
  //       }
  //
  //       while (loc < src.byteLength) {
  //         const row = new Array(columns.names.length)
  //         while (columnIndex < columns.names.length) {
  //           const decodeResult = (
  //             columns.decoders[columnIndex] as any as SimpleTypeDecoderDataView
  //           )(src, loc)
  //           //console.log(decodeResult, loc, src.length, columns?.names[columnIndex], columns?.types[columnIndex])
  //           // not enough data to finish the row - null indicates that
  //           if (decodeResult === null) {
  //             // will be added to the beginning of the next received chunk
  //             incompleteChunk = new Uint8Array(src.buffer.slice(loc))
  //             if (rowsToPush.length > 0) {
  //               // console.log(`pushing ${rowsToPush.length} rows`)
  //               this.push(rowsToPush)
  //               rowsToPush.length = 0
  //             }
  //             return callback()
  //           } else {
  //             // decoded a value
  //             row[columnIndex] = decodeResult[0]
  //             loc = decodeResult[1]
  //             columnIndex++
  //           }
  //         }
  //         rowsToPush.push(row)
  //         columnIndex = 0
  //       }
  //
  //       if (loc > src.byteLength) {
  //         incompleteChunk = new Uint8Array(
  //           src.buffer.slice(loc - src.byteLength)
  //         )
  //       }
  //
  //       if (rowsToPush.length > 0) {
  //         // console.log(`pushing ${rowsToPush.length} rows`)
  //         this.push(rowsToPush)
  //         rowsToPush.length = 0
  //       }
  //
  //       return callback()
  //     },
  //     final(callback: TransformCallback) {
  //       if (rowsToPush.length > 0) {
  //         this.push(rowsToPush)
  //         rowsToPush.length = 0
  //       }
  //       return callback()
  //     },
  //     autoDestroy: true,
  //     objectMode: true,
  //   })
  //
  //   return Stream.pipeline(this._stream, toRows, function pipelineCb(err) {
  //     if (err) {
  //       // FIXME: use logger instead
  //       // eslint-disable-next-line no-console
  //       console.error(err)
  //     }
  //   })
  // }

  close() {
    this._stream.destroy()
  }
}
