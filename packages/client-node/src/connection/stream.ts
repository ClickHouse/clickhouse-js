import type Stream from 'stream'

/** Drains the response stream, as calling `destroy` on a {@link Stream.Readable} response stream
 *  will result in closing the underlying socket, and negate the KeepAlive feature benefits.
 *  See https://github.com/ClickHouse/clickhouse-js/pull/203 */
export async function drainStream(stream: Stream.Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    // Avoid a race condition where the stream has already sent the 'end' event before we attach the listener.
    // In this case, we can resolve the promise immediately without attaching any listeners.
    if (stream.readableEnded) {
      // the stream is already ended, no need to attach listeners
      resolve()
      return
    }

    // Similarly, if the stream has already emitted an error, we can reject the promise immediately.
    if (stream.errored) {
      // the stream is already errored, no need to attach listeners
      reject(stream.errored)
      return
    }

    function dropData() {
      // used only for the methods without expected response; we don't care about the data here
    }

    function onEnd() {
      removeListeners()
      resolve()
    }

    function onError(err: Error) {
      removeListeners()
      reject(err)
    }

    function onClose() {
      removeListeners()
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
