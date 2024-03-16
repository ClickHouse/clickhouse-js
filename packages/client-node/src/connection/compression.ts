import type Http from 'http'
import Stream from 'stream'
import Zlib from 'zlib'

export function decompressResponse(response: Http.IncomingMessage):
  | {
      response: Stream.Readable
    }
  | { error: Error } {
  const encoding = response.headers['content-encoding']

  if (encoding === 'gzip') {
    return {
      response: Stream.pipeline(
        response,
        Zlib.createGunzip(),
        function pipelineCb(err) {
          if (err) {
            // FIXME: use logger instead
            // eslint-disable-next-line no-console
            console.error(err)
          }
        }
      ),
    }
  } else if (encoding !== undefined) {
    return {
      error: new Error(`Unexpected encoding: ${encoding}`),
    }
  }

  return { response }
}

export function isDecompressionError(result: any): result is { error: Error } {
  return result.error !== undefined
}
