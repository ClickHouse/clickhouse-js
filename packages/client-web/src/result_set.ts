import type { BaseResultSet, DataFormat, Row } from '@clickhouse/client-common'
import { decode, validateStreamFormat } from '@clickhouse/client-common'
import { getAsText } from './utils'

export class ResultSet implements BaseResultSet<ReadableStream<Row[]>> {
  private isAlreadyConsumed = false
  constructor(
    private _stream: ReadableStream,
    private readonly format: DataFormat,
    public readonly query_id: string,
  ) {}

  async text(): Promise<string> {
    this.markAsConsumed()
    return getAsText(this._stream)
  }

  async json<T>(): Promise<T> {
    const text = await this.text()
    return decode(text, this.format)
  }

  stream(): ReadableStream<Row[]> {
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

    return this._stream.pipeThrough(transform, {
      preventClose: false,
      preventAbort: false,
      preventCancel: false,
    })
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
