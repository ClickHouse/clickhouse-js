import type {
  BaseResultSet,
  DataFormat,
  JSONHandling,
  ResponseHeaders,
  ResultJSONType,
  ResultStream,
  Row,
} from '@clickhouse/client-common'
import {
  CARET_RETURN,
  extractErrorAtTheEndOfChunk,
} from '@clickhouse/client-common'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  validateStreamFormat,
} from '@clickhouse/client-common'
import { getAsText } from './utils'

const NEWLINE = 0x0a as const

export class ResultSet<
  Format extends DataFormat | unknown,
> implements BaseResultSet<ReadableStream<Row[]>, Format> {
  public readonly response_headers: ResponseHeaders

  private readonly exceptionTag: string | undefined = undefined
  private isAlreadyConsumed = false
  private readonly jsonHandling: JSONHandling

  constructor(
    private _stream: ReadableStream,
    private readonly format: Format,
    public readonly query_id: string,
    _response_headers?: ResponseHeaders,
    jsonHandling: JSONHandling = {
      parse: JSON.parse,
      stringify: JSON.stringify,
    },
  ) {
    this.response_headers =
      _response_headers !== undefined ? Object.freeze(_response_headers) : {}
    this.exceptionTag = this.response_headers['x-clickhouse-exception-tag'] as
      | string
      | undefined

    this.jsonHandling = jsonHandling
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
      const result: T[] = []
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
      return this.jsonHandling.parse(text)
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} as JSON`)
  }

  /** See {@link BaseResultSet.stream} */
  stream<T>(): ResultStream<Format, ReadableStream<Row<T, Format>[]>> {
    this.markAsConsumed()
    validateStreamFormat(this.format)

    const incompleteChunks: Uint8Array[] = []
    let totalIncompleteLength = 0

    const exceptionTag = this.exceptionTag
    const jsonHandling = this.jsonHandling
    const decoder = new TextDecoder('utf-8')
    const transform = new TransformStream({
      start() {
        //
      },
      transform: (chunk: Uint8Array, controller) => {
        if (chunk === null) {
          controller.terminate()
        }

        const rows: Row[] = []

        let idx: number
        let lastIdx = 0

        while (true) {
          // an unescaped newline character denotes the end of a row,
          // or at least the beginning of the exception marker
          idx = chunk.indexOf(NEWLINE, lastIdx)
          if (idx === -1) {
            // there is no complete row in the rest of the current chunk
            // to be processed during the next transform iteration
            const incompleteChunk = chunk.slice(lastIdx)
            incompleteChunks.push(incompleteChunk)
            totalIncompleteLength += incompleteChunk.length

            // send the extracted rows to the consumer, if any
            if (rows.length > 0) {
              controller.enqueue(rows)
            }
            break
          } else {
            let bytesToDecode: Uint8Array

            // Check for exception in the chunk (only after 25.11)
            if (
              exceptionTag !== undefined &&
              idx >= 1 &&
              chunk[idx - 1] === CARET_RETURN
            ) {
              controller.error(extractErrorAtTheEndOfChunk(chunk, exceptionTag))
            }

            // using the incomplete chunks from the previous iterations
            if (incompleteChunks.length > 0) {
              const completeRowBytes = new Uint8Array(
                totalIncompleteLength + idx,
              )

              let offset = 0
              incompleteChunks.forEach((incompleteChunk) => {
                completeRowBytes.set(incompleteChunk, offset)
                offset += incompleteChunk.length
              })

              // finalize the row with the current chunk slice that ends with a newline
              const finalChunk = chunk.slice(0, idx)
              completeRowBytes.set(finalChunk, offset)

              // Reset the incomplete chunks.
              // Removing used buffers and reusing the already allocated memory
              // by setting length to 0
              incompleteChunks.length = 0
              totalIncompleteLength = 0

              bytesToDecode = completeRowBytes
            } else {
              bytesToDecode = chunk.slice(lastIdx, idx)
            }

            const text = decoder.decode(bytesToDecode)
            rows.push({
              text,
              json<T>(): T {
                return jsonHandling.parse(text)
              },
            })

            lastIdx = idx + 1 // skipping newline character
          }
        }
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

  /**
   * Closes the `ResultSet`.
   *
   * Automatically called when using `using` statement in supported environments.
   * @see {@link ResultSet.close}
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/using
   */
  async [Symbol.asyncDispose]() {
    await this.close()
  }

  private markAsConsumed() {
    if (this.isAlreadyConsumed) {
      throw new Error(streamAlreadyConsumedMessage)
    }
    this.isAlreadyConsumed = true
  }
}

const streamAlreadyConsumedMessage = 'Stream has been already consumed'
