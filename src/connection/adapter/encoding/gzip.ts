import Stream from 'stream'
import Zlib from 'zlib'
import type Http from 'http'
import type { LogWriter } from '../../../logger'

export function gzipEncodedStream(
  bodyStream: Stream.Readable,
  request: Http.ClientRequest,
  callback: (err: NodeJS.ErrnoException | null) => void
) {
  return Stream.pipeline(bodyStream, Zlib.createGzip(), request, callback)
}

export function gzipDecodedStream(
  response: Http.IncomingMessage,
  logger: LogWriter
): Stream.Readable {
  return Stream.pipeline(
    response,
    Zlib.createGunzip(),
    function pipelineCb(err) {
      if (err) {
        logger.error({
          err,
          module: 'GZIP',
          message: 'Failed to decode the incoming message',
        })
      }
    }
  )
}
