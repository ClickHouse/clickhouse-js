import type {
  BaseResultSet,
  DataFormat,
  ResultJSONType,
  ResultStream,
  Row,
} from '@clickhouse/client-common'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
} from '@clickhouse/client-common'
import { validateStreamFormat } from '@clickhouse/client-common'
import { getAsText } from './utils'

export class ResultSet<Format extends DataFormat | unknown>
  implements BaseResultSet<ReadableStream<Row[]>, Format>
{
  private isAlreadyConsumed = false
  constructor(
    private _stream: ReadableStream,
    private readonly format: Format,
    public readonly query_id: string,
  ) {}

  /** See {@link BaseResultSet.text} */
  async text(): Promise<string> {
    this.markAsConsumed()
    return getAsText(this._stream)
  }

  /** See {@link BaseResultSet.json} */
  async json<T>(): Promise<ResultJSONType<T, Format>> {
    this.markAsConsumed()
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format as DataFormat)) {
      const result: T[] = []
      const reader = this.stream<T>().getReader()
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        for (const row of value) {
          result.push(row.json())
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
  stream<T>(): ResultStream<Format, ReadableStream<Row<T, Format>[]>> {
    this.markAsConsumed()
    validateStreamFormat(this.format)

    let decodedChunk = ''
    const decoder = new TextDecoder('utf-8')
    const transform = new TransformStream({
      start() {
        //
      },
      transform: (chunk, controller) => {
        if (chunk === null) {
          controller.terminate()
        }
        decodedChunk += decoder.decode(chunk)
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
                return JSON.parse(text)
              },
            })
          } else {
            if (rows.length) {
              controller.enqueue(rows)
            }
            break
          }
        }
      },
      flush() {
        decodedChunk = ''
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
