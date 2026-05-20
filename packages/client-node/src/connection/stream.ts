import {
  type LogWriter,
  type ConnOperation,
  ClickHouseLogLevel,
} from '@clickhouse/client-common'
import type Stream from 'stream'

export interface Context {
  op: ConnOperation
  log_level: ClickHouseLogLevel
  log_writer: LogWriter
  query_id: string
}

/** Drains the response stream, as calling `destroy` on a {@link Stream.Readable} response stream
 *  will result in closing the underlying socket, and negate the KeepAlive feature benefits.
 *  See https://github.com/ClickHouse/clickhouse-js/pull/203
 *  @deprecated This method is not intended to be used outside of the client implementation anymore. Use `client.command()` instead, which will handle draining the stream internally when needed.
 * */
export async function drainStream(stream: Stream.Readable): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _ of stream) {
    // consume the stream
  }
}

/** Drains the response stream, as calling `destroy` on a {@link Stream.Readable} response stream
 *  will result in closing the underlying socket, and negate the KeepAlive feature benefits.
 * Also, provides additional internal logging for debugging stream issues. Not intended to be used outside of the client implementation.
 *  See https://github.com/ClickHouse/clickhouse-js/pull/203 */
export async function drainStreamInternal(
  ctx: Context,
  stream: Stream.Readable,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now()
    let bytesReceived = 0
    let chunkCount = 0

    if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
      ctx.log_writer.trace({
        message: `${ctx.op}: starting stream drain`,
        args: {
          query_id: ctx.query_id,
          stream_state: {
            readable: stream.readable,
            readableEnded: stream.readableEnded,
            readableLength: stream.readableLength,
          },
        },
      })
    }

    // If the stream has already emitted an error, we can reject the promise immediately.
    if (stream.errored) {
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        ctx.log_writer.trace({
          message: `${ctx.op}: stream already errored before drain`,
          args: {
            query_id: ctx.query_id,
            chunk_number: chunkCount,
            total_bytes_received: bytesReceived,
          },
        })
      }
      // the stream is already errored, no need to attach listeners
      reject(stream.errored)
      return
    }

    // Avoid a race condition where the stream has already sent the 'end' event before we attach the listener.
    // In this case, we can resolve the promise immediately without attaching any listeners.
    if (stream.readableEnded) {
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        ctx.log_writer.trace({
          message: `${ctx.op}: stream already ended before drain`,
          args: {
            query_id: ctx.query_id,
            chunk_number: chunkCount,
            total_bytes_received: bytesReceived,
          },
        })
      }
      // the stream is already ended, no need to attach listeners
      resolve()
      return
    }

    // If the stream is already closed, we can resolve the promise immediately as well.
    if (stream.closed) {
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        ctx.log_writer.trace({
          message: `${ctx.op}: stream already closed before drain`,
          args: {
            query_id: ctx.query_id,
            chunk_number: chunkCount,
            total_bytes_received: bytesReceived,
          },
        })
      }
      // the stream is already closed, no need to attach listeners
      resolve()
      return
    }

    function dropData(chunk: Buffer | string) {
      // used only for the methods without expected response; we don't care about the data here
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        chunkCount++
        const chunk_size = Buffer.byteLength(chunk)
        bytesReceived += chunk_size
        ctx.log_writer.trace({
          message: `${ctx.op}: received data chunk during drain`,
          args: {
            query_id: ctx.query_id,
            chunk_number: chunkCount,
            chunk_size,
            total_bytes_received: bytesReceived,
          },
        })
      }
    }

    function onEnd() {
      removeListeners()
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        const duration = Date.now() - startTime
        ctx.log_writer.trace({
          message: `${ctx.op}: stream drain completed (end event)`,
          args: {
            query_id: ctx.query_id,
            duration_ms: duration,
            total_bytes_received: bytesReceived,
            total_chunks: chunkCount,
          },
        })
      }
      resolve()
    }

    function onError(err: Error) {
      removeListeners()
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        const duration = Date.now() - startTime
        ctx.log_writer.trace({
          message: `${ctx.op}: stream drain failed (error event)`,
          args: {
            query_id: ctx.query_id,
            duration_ms: duration,
            total_bytes_received: bytesReceived,
            total_chunks: chunkCount,
            error: err.message,
          },
        })
      }
      reject(err)
    }

    function onClose() {
      removeListeners()
      if (ctx.log_level <= ClickHouseLogLevel.TRACE) {
        const duration = Date.now() - startTime
        ctx.log_writer.trace({
          message: `${ctx.op}: stream closed during drain (close event)`,
          args: {
            query_id: ctx.query_id,
            duration_ms: duration,
            total_bytes_received: bytesReceived,
            total_chunks: chunkCount,
          },
        })
      }
      // The `end` event might not be emitted if the server closes the connection.
      // Making sure to resolve the promise in this case as well.
      resolve()
    }

    function removeListeners() {
      stream.removeListener('data', dropData)
      stream.removeListener('end', onEnd)
      stream.removeListener('error', onError)
      stream.removeListener('close', onClose)
    }

    stream.on('data', dropData)
    stream.on('end', onEnd)
    stream.on('error', onError)
    stream.on('close', onClose)
  })
}
