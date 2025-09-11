import type {
  BaseResultSet,
  DataFormat,
  ResponseHeaders,
  ResultJSONType,
  ResultStream,
  Row,
} from '@clickhouse/client-common'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  validateStreamFormat,
} from '@clickhouse/client-common'
import { getAsText } from './utils'

const NEWLINE = 0x0a as const

export class ResultSet<Format extends DataFormat | unknown>
  implements BaseResultSet<ReadableStream<Array<Row>>, Format>
{
  public readonly response_headers: ResponseHeaders
  private isAlreadyConsumed = false

  constructor(
    private _stream: ReadableStream,
    private readonly format: Format,
    public readonly query_id: string,
    _response_headers?: ResponseHeaders,
  ) {
    this.response_headers =
      _response_headers !== undefined ? Object.freeze(_response_headers) : {}
  }

  /** See {@link BaseResultSet.text} */
  async text(): Promise<string> {
    this.markAsConsumed()
    return getAsText(this._stream)
  }

  /** See {@link BaseResultSet.json} */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const result: Array<T> = []
      const reader = this.stream<T>().getReader()

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        for (const row of value) {
          result.push(row.json() as T)
        }
      }
      return result as any
    }
    // JSON, JSONObjectEachRow, etc.
    if (isNotStreamableJSONFamily(this.format as DataFormat)) {
      const text = await getAsText(this._stream)
      return JSON.parse(text)
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} as JSON`)
  }

  /** See {@link BaseResultSet.stream} */
  stream<T>(): ResultStream<Format, ReadableStream<Array<Row<T, Format>>>> {
    this.markAsConsumed()
    validateStreamFormat(this.format)

    let incompleteChunks: Array<Uint8Array> = []
    let totalIncompleteLength = 0
    const decoder = new TextDecoder('utf-8')
    const transform = new TransformStream({
      start() {
        //
      },
      transform: (chunk: Uint8Array, controller) => {
        if (chunk === null) {
          controller.terminate()
        }
        const rows: Array<Row> = []
        let idx: number
        let lastIdx = 0
        do {
          // an unescaped newline character denotes the end of a row
          idx = chunk.indexOf(NEWLINE, lastIdx)
          // there is no complete row in the rest of the current chunk
          if (idx === -1) {
            // to be processed during the next transform iteration
            const incompleteChunk = chunk.slice(lastIdx)
            incompleteChunks.push(incompleteChunk)
            totalIncompleteLength += incompleteChunk.length
            // send the extracted rows to the consumer, if any
            if (rows.length > 0) {
              controller.enqueue(rows)
            }
          } else {
            let text: string
            if (incompleteChunks.length > 0) {
              const completeRowBytes = new Uint8Array(
                totalIncompleteLength + idx,
              )

              // using the incomplete chunks from the previous iterations
              let offset = 0
              incompleteChunks.forEach((incompleteChunk) => {
                completeRowBytes.set(incompleteChunk, offset)
                offset += incompleteChunk.length
              })
              // finalize the row with the current chunk slice that ends with a newline
              const finalChunk = chunk.slice(0, idx)
              completeRowBytes.set(finalChunk, offset)

              // reset the incomplete chunks
              incompleteChunks = []
              totalIncompleteLength = 0

              text = decoder.decode(completeRowBytes)
            } else {
              text = decoder.decode(chunk.slice(lastIdx, idx))
            }
            rows.push({
              text,
              json<T>(): T {
                return JSON.parse(text)
              },
            })
            lastIdx = idx + 1 // skipping newline character
          }
        } while (idx !== -1)
      },
    })

    const pipeline = this._stream.pipeThrough(transform, {
      preventClose: false,
      preventAbort: false,
      preventCancel: false,
    })
    return pipeline as any
  }

  async close(): Promise<void> {
    this.markAsConsumed()
    await this._stream.cancel()
  }

  private markAsConsumed() {
    if (this.isAlreadyConsumed) {
      throw new Error(streamAlreadyConsumedMessage)
    }
    this.isAlreadyConsumed = true
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
