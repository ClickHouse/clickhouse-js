import type { BaseResultSet, DataFormat } from '@clickhouse/client-common'
import type { DecodedColumns } from '@clickhouse/client-common/src/data_formatter/row_binary/columns_header'
import { RowBinaryColumnsHeader } from '@clickhouse/client-common/src/data_formatter/row_binary/columns_header'
import { Buffer } from 'buffer'
import Stream, { Transform, type TransformCallback } from 'stream'

export interface RowBinaryStreamParams {
  /** Determines whether each row will be returned as an array or an object. Possible options: 'Array', 'Object'.
   *
   *  NB: Object mode will reduce performance by approximately 25-30%, as there will be processing overhead
   *  (similar to JSONEachRow vs JSONCompactEachRow).
   *
   *  Default: 'Array'. */
  mode?: 'Array' | 'Object'
}

// FIXME: remove BaseResultSet inheritance (after 1.0.0 is merged).
// FIXME: add logger (after 1.0.0 is merged).
export class RowBinaryResultSet implements BaseResultSet<Stream.Readable> {
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat,
    public readonly query_id: string
  ) {}

  // FIXME: remove this (after 1.0.0 is merged).
  async text(): Promise<string> {
    throw new Error(
      `Can't call 'text()' on RowBinary result set; please use 'stream' instead`
    )
  }

  // FIXME: remove this (after 1.0.0 is merged).
  async json<T>(): Promise<T> {
    throw new Error(
      `Can't call 'json()' on RowBinary result set; please use 'stream' instead`
    )
  }

  /** Consume the entire stream at once and get all the rows as a single array.
   *  If your result set might be too large, consider using {@link stream} instead.
   *
   *  @returns {Promise} - An array of rows.
   */
  async get<T = unknown>(params?: RowBinaryStreamParams): Promise<T[]> {
    if (this.format !== 'RowBinary') {
      throw new Error(
        `Can't use RowBinaryResultSet if the format is not RowBinary`
      )
    }
    const result: any[] = []
    await new Promise((resolve, reject) => {
      this.stream(params)
        .on('data', (rows: unknown[][]) => {
          for (let i = 0; i < rows.length; i++) {
            result.push(rows[i] as any)
          }
        })
        .on('end', resolve)
        .on('error', reject)
    })
    return result
  }

  // FIXME: return StreamReadable after 1.0.0.
  stream(params?: RowBinaryStreamParams): Stream.Readable {
    // If the underlying stream has already ended,
    // Stream.pipeline will create a new empty stream,
    // but without "readableEnded" flag set to true
    if (this._stream.readableEnded) {
      throw Error('Stream has been already consumed')
    }
    if (this.format !== 'RowBinary') {
      throw Error(`Format ${this.format} is not RowBinary`)
    }

    // ClickHouse columns with their types; decoded from the header in the first chunk(s)
    let columns: DecodedColumns[0] | undefined
    // Current column index in the row being processed
    let columnIndex = 0
    // Fully decoded rows, pending to be pushed downstream
    let decodedRows: any[] = []
    // Whether to return each row as an object or an array
    const asObject = params?.mode === 'Object' ?? false
    // Used as a prototype if it's Object mode
    let protoObject: any

    let src: Buffer
    let incompleteChunk: Buffer | undefined

    // const measures: Record<string, number> = {}
    // let iterations = 0
    // let incompleteChunksTotal = 0
    // const NS_PER_SEC = 1e9

    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        if (chunk.length === 0) {
          return callback()
        }

        if (incompleteChunk !== undefined) {
          src = Buffer.concat(
            [incompleteChunk, chunk],
            incompleteChunk.length + chunk.length
          )
          incompleteChunk = undefined
        } else {
          src = chunk
        }

        let loc = 0
        if (columns === undefined) {
          try {
            const res = RowBinaryColumnsHeader.decode(src)
            columns = res[0]
            loc = res[1]
            if (asObject) {
              protoObject = Object.create(null)
              for (let i = 0; i < columns.names.length; i++) {
                protoObject[columns.names[i]] = undefined
              }
            }
          } catch (err) {
            return callback(err as Error)
          }
        }

        // function logIterationExecutionTime(end: [number, number]) {
        //   const col = columns!.types[columnIndex]
        //   const name = columns!.names[columnIndex]
        //   const execTime = end[0] * NS_PER_SEC + end[1]
        //   iterations++
        //   const key = `${col.dbType} - ${name}`
        //   measures[key] = (measures[key] || 0) + execTime
        // }

        let lastLoc = 0
        while (loc < src.length) {
          const row = asObject
            ? Object.create(protoObject)
            : new Array(columns.names.length)
          while (columnIndex < columns.names.length) {
            // const start = process.hrtime()
            const decodeResult = columns.decoders[columnIndex](src, loc)

            // const end = process.hrtime(start)
            // logIterationExecutionTime(end)

            // not enough data to finish the row - null indicates that
            if (decodeResult === null) {
              // incompleteChunksTotal++
              // will be added to the beginning of the next received chunk
              incompleteChunk = src.subarray(loc)
              if (decodedRows.length > 0) {
                // console.log(`pushing ${rowsToPush.length} rows`)
                this.push(decodedRows)
                decodedRows = []
              }
              return callback()
            } else {
              // successfully decoded a value for the column
              if (asObject) {
                ;(row as any)[columns.names[columnIndex]] = decodeResult[0]
              } else {
                ;(row as any[])[columnIndex] = decodeResult[0]
              }
              loc = decodeResult[1]
              columnIndex++
              lastLoc = loc
            }
          }
          decodedRows.push(row)
          columnIndex = 0
        }

        if (loc > src.length) {
          console.log(`loc > src.length, ${loc} > ${src.length}`)
        }

        if (decodedRows.length > 0) {
          // console.log(`pushing ${rowsToPush.length} rows`)
          this.push(decodedRows)
          decodedRows = []
        }

        return callback()
      },
      final(callback: TransformCallback) {
        if (decodedRows.length > 0) {
          this.push(decodedRows)
          decodedRows = []
        }
        // console.log(`Measures (${iterations})`, measures)
        // for (const key in measures) {
        //   console.log(`Avg ns for ${key}:`, measures[key] / iterations)
        // }
        // console.log(`Incomplete chunks total:`, incompleteChunksTotal)
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
