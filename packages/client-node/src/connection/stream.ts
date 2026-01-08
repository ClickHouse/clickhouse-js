import type { LogWriter } from '@clickhouse/client-common'
import type Stream from 'stream'

/** Drains the response stream, as calling `destroy` on a {@link Stream.Readable} response stream
 *  will result in closing the underlying socket, and negate the KeepAlive feature benefits.
 *  See https://github.com/ClickHouse/clickhouse-js/pull/203 */
export async function drainStream(
  stream: Stream.Readable,
  logger?: LogWriter,
  query_id?: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    let bytesReceived = 0
    let chunkCount = 0

    logger?.trace({
      message: 'Command: starting stream drain',
      args: {
        query_id,
        stream_state: {
          readable: stream.readable,
          readableEnded: stream.readableEnded,
          readableLength: stream.readableLength,
        },
      },
    })

    function dropData(chunk: Buffer | string) {
      // used only for the methods without expected response; we don't care about the data here
      chunkCount++
      if (Buffer.isBuffer(chunk)) {
        bytesReceived += chunk.length
      } else if (typeof chunk === 'string') {
        bytesReceived += Buffer.byteLength(chunk)
      }
      logger?.trace({
        message: 'Command: received data chunk during drain',
        args: {
          query_id,
          chunk_number: chunkCount,
          chunk_size: Buffer.isBuffer(chunk)
            ? chunk.length
            : Buffer.byteLength(chunk),
          total_bytes_received: bytesReceived,
        },
      })
    }

    function onEnd() {
      removeListeners()
      const duration = Date.now() - startTime
      logger?.trace({
        message: 'Command: stream drain completed (end event)',
        args: {
          query_id,
          duration_ms: duration,
          total_bytes_received: bytesReceived,
          total_chunks: chunkCount,
        },
      })
      resolve()
    }

    function onError(err: Error) {
      removeListeners()
      const duration = Date.now() - startTime
      logger?.trace({
        message: 'Command: stream drain failed (error event)',
        args: {
          query_id,
          duration_ms: duration,
          total_bytes_received: bytesReceived,
          total_chunks: chunkCount,
          error: err.message,
        },
      })
      reject(err)
    }

    function onClose() {
      removeListeners()
      const duration = Date.now() - startTime
      logger?.trace({
        message: 'Command: stream closed during drain (close event)',
        args: {
          query_id,
          duration_ms: duration,
          total_bytes_received: bytesReceived,
          total_chunks: chunkCount,
        },
      })
    }

    function removeListeners() {
      stream.removeListener('data', dropData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
      stream.removeListener('onClose', onClose)
    }

    stream.on('data', dropData)
    stream.on('end', onEnd)
    stream.on('error', onError)
    stream.on('close', onClose)
  })
}
