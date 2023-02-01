import type { TransformCallback } from 'stream'
import Stream, { Transform } from 'stream'
import lz4 from 'lz4-napi'
import type { LogWriter } from '../../../logger'
import type Http from 'http'

export function lz4EncodedStream(
  bodyStream: Stream.Readable,
  request: Http.ClientRequest,
  callback: (err: NodeJS.ErrnoException | null) => void
) {
  return Stream.pipeline(
    bodyStream,
    new Transform({
      async transform(
        chunk: Buffer | string,
        encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        try {
          const decoded = lz4.compressSync(chunk)
          this.push(decoded)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    }),
    request,
    callback
  )
}

export function lz4DecodedStream(
  response: Http.IncomingMessage,
  logger: LogWriter
): Stream.Readable {
  return Stream.pipeline(
    response,
    new Transform({
      transform(
        chunk: Buffer | string,
        encoding: BufferEncoding,
        callback: TransformCallback
      ) {
        try {
          const decoded = lz4.uncompressSync(chunk)
          this.push(decoded)
          callback()
        } catch (err) {
          callback(err as Error)
        }
      },
    }),
    function pipelineCb(err) {
      if (err) {
        logger.error({
          err,
          module: 'LZ4',
          message: 'Failed to decode the incoming message',
        })
      }
    }
  )
}
//
// class LZ4Decoder extends Transform {
//   // private readonly logger: LogWriter
//   constructor(opts: TransformOptions & { logger?: LogWriter }) {
//     super(opts)
//     // this.logger = opts.logger
//   }
//   _transform(
//     chunk: Buffer,
//     encoding: BufferEncoding,
//     callback: TransformCallback
//   ): void {
//     const decoded = lz4.uncompressSync(chunk)
//     this.push(decoded)
//     callback()
//     // .then((data) => {
//     //   this.push(data)
//     //   callback()
//     // })
//     // .catch((err) => {
//     //   this.logger.error({
//     //     err,
//     //     module: 'LZ4',
//     //     message: 'Failed to decode the chunk',
//     //     args: {
//     //       chunk: chunk.toString('utf-8'),
//     //     },
//     //   })
//     //   this.destroy()
//     // })
//   }
// }
