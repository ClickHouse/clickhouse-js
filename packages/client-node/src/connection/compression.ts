import type { LogWriter } from '@clickhouse/client-common'
import type Http from 'http'
import Stream from 'stream'
import Zlib from 'zlib'
import * as zstd from 'zstd-napi'

type DecompressResponseResult = { response: Stream.Readable } | { error: Error }

function createZstdDecompressStream(): Stream.Transform {
  return new Stream.Transform({
    transform(chunk: Buffer, encoding, callback) {
      try {
        const decompressed = zstd.decompress(chunk)
        callback(null, decompressed)
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)))
      }
    },
  })
}

export function decompressResponse(
  response: Http.IncomingMessage,
  logWriter: LogWriter,
): DecompressResponseResult {
  const encoding = response.headers['content-encoding']

  if (encoding === 'gzip') {
    return {
      response: Stream.pipeline(
        response,
        Zlib.createGunzip(),
        function pipelineCb(err) {
          if (err) {
            logWriter.error({
              message: 'An error occurred while decompressing the response',
              err,
            })
          }
        },
      ),
    }
  } else if (encoding === 'zstd') {
    return {
      response: Stream.pipeline(
        response,
        createZstdDecompressStream(),
        function pipelineCb(err) {
          if (err) {
            logWriter.error({
              message: 'An error occurred while decompressing the response',
              err,
            })
          }
        },
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
