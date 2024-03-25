import type {
  BaseResultSet,
  DataFormat,
  ResultJSONType,
  Row,
} from '@clickhouse/client-common'
import { decode, validateStreamFormat } from '@clickhouse/client-common'
import type { StreamableDataFormat } from '@clickhouse/client-common/src/data_formatter'
import { getAsText } from './utils'

export class ResultSet<Format extends DataFormat>
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
    const text = await this.text()
    return decode(text, this.format)
  }

  /** See {@link BaseResultSet.stream} */
  stream<T>(): Format extends StreamableDataFormat
    ? ReadableStream<Row<T, Format>[]>
    : never {
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
                return decode(text, 'JSON')
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
