import { randomUUID } from '@test/utils/guid'
import type { ClientRequest } from 'http'
import type Http from 'http'
import Stream from 'stream'
import Util from 'util'
import Zlib from 'zlib'

const gzip = Util.promisify(Zlib.gzip)

export function buildIncomingMessage({
  body = '',
  statusCode = 200,
  headers = {},
}: {
  body?: string | Buffer
  statusCode?: number
  headers?: Http.IncomingHttpHeaders
}): Http.IncomingMessage {
  const response = new Stream.Readable({
    read() {
      this.push(body)
      this.push(null)
    },
  }) as Http.IncomingMessage

  response.statusCode = statusCode
  response.headers = {
    'x-clickhouse-query-id': randomUUID(),
    ...headers,
  }
  return response
}

export function stubClientRequest() {
  const request = new Stream.Writable({
    write() {
      /** stub */
    },
  }) as ClientRequest
  request.getHeaders = () => ({})
  return request
}

export function emitResponseBody(
  request: Http.ClientRequest,
  body: string | Buffer | undefined,
) {
  request.emit(
    'response',
    buildIncomingMessage({
      body,
    }),
  )
}

export async function emitCompressedBody(
  request: ClientRequest,
  body: string | Buffer,
  encoding = 'gzip',
) {
  const compressedBody = await gzip(body)
  request.emit(
    'response',
    buildIncomingMessage({
      body: compressedBody,
      headers: {
        'content-encoding': encoding,
      },
    }),
  )
}
