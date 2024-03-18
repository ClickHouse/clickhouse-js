import type {
  BaseResultSet,
  ClickHouseSummary,
  DataFormat,
  ResultSetSummary,
  Row,
} from '@clickhouse/client-common'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  validateStreamFormat,
} from '@clickhouse/client-common'
import { Buffer } from 'buffer'
import type { TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'
import { getAsText } from './utils'

const NEWLINE = 0x0a as const

export class ResultSet implements BaseResultSet<Stream.Readable> {
  private readonly _summary: ResultSetSummary
  constructor(
    private _stream: Stream.Readable,
    private readonly format: DataFormat,
    public readonly query_id: string,
    clickhouse_summary?: ClickHouseSummary
  ) {
    this._summary = {
      server: clickhouse_summary,
      client: {
        response_processing_time_ms: 0,
        response_processed_bytes: 0,
      },
    }
  }

  async text(): Promise<string> {
    if (this._stream.readableEnded) {
      throw Error(ResultSetErrorMessages.streamAlreadyConsumed)
    }
    const start = +new Date()
    const { text, processed_bytes } = await getAsText(this._stream)
    this._summary.client.response_processing_time_ms = +new Date() - start
    this._summary.client.response_processed_bytes = processed_bytes
    return text
  }

  async json<T>(): Promise<T> {
    if (this._stream.readableEnded) {
      throw Error(ResultSetErrorMessages.streamAlreadyConsumed)
    }
    // JSONEachRow, etc.
    if (isStreamableJSONFamily(this.format)) {
      const result: unknown[] = []
      await new Promise((resolve, reject) => {
        // summary will be handled in the transformer
        const stream = this.stream()
        stream.on('data', (rows: Row[]) => {
          rows.forEach((row) => {
            result.push(row.json())
          })
        })
        stream.on('end', resolve)
        stream.on('error', reject)
      })
      return result as any
    }
    // JSON, etc.
    if (isNotStreamableJSONFamily(this.format)) {
      const start = +new Date()
      const { text, processed_bytes } = await getAsText(this._stream)
      this._summary.client.response_processed_bytes = processed_bytes
      const parseResult = JSON.parse(text)
      this._summary.client.response_processing_time_ms = +new Date() - start
      return parseResult
    }
    // should not be called for CSV, etc.
    throw new Error(`Cannot decode ${this.format} to JSON`)
  }

  stream(): Stream.Readable {
    // If the underlying stream has already ended by calling `text` or `json`,
    // Stream.pipeline will create a new empty stream
    // but without "readableEnded" flag set to true
    if (this._stream.readableEnded) {
      throw Error(ResultSetErrorMessages.streamAlreadyConsumed)
    }

    validateStreamFormat(this.format)

    let incompleteChunks: Buffer[] = []
    const clientSummary = this._summary.client
    const start = +new Date()
    const toRows = new Transform({
      transform(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        const rows: Row[] = []
        let lastIdx = 0

        clientSummary.response_processed_bytes += chunk.length

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
      final(callback: TransformCallback) {
        clientSummary.response_processing_time_ms = +new Date() - start
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

  summary(): ResultSetSummary {
    if (!this._stream.readableEnded) {
      throw Error(ResultSetErrorMessages.summaryIsNotAvailableYet)
    }
    return this._summary
  }

  close() {
    this._stream.destroy()
  }
}

const ResultSetErrorMessages = {
  streamAlreadyConsumed: 'Stream has been already consumed',
  summaryIsNotAvailableYet:
    'The summary will be available after the stream is fully consumed. ' +
    'You can use `text` or `json` methods to load the entire stream content into memory, ' +
    'or call `stream` method to manually process the decoded rows.',
}
