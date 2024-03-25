import { LogWriter } from '@clickhouse/client-common'
import { TestLogger } from '@test/utils'
import { randomUUID } from '@test/utils/guid'
import type Http from 'http'
import type { ClientRequest } from 'http'
import Stream from 'stream'
import Util from 'util'
import Zlib from 'zlib'
import {
  NodeBaseConnection,
  type NodeConnectionParams,
  NodeHttpConnection,
} from '../../src/connection'

const gzip = Util.promisify(Zlib.gzip)

export const socketStub = {
  on: () => {
    //
  },
  setTimeout: () => {
    //
  },
  removeListener: () => {
    //
  },
}

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

export function stubClientRequest(): ClientRequest {
  const request = new Stream.Writable({
    write() {
      /** stub */
    },
  }) as ClientRequest
  request.getHeaders = () => ({})
  Object.assign(request, {
    socket: socketStub,
  })
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

export function buildHttpConnection(config: Partial<NodeConnectionParams>) {
  return new NodeHttpConnection({
    url: new URL('http://localhost:8123'),

    request_timeout: 30_000,
    compression: {
      decompress_response: true,
      compress_request: false,
    },
    max_open_connections: 10,

    username: 'default',
    password: '',
    database: 'default',
    clickhouse_settings: {},

    log_writer: new LogWriter(new TestLogger(), 'NodeConnectionTest'),
    keep_alive: {
      enabled: false,
      idle_socket_ttl: 2500,
    },
    ...config,
  })
}

export class MyTestHttpConnection extends NodeBaseConnection {
  constructor(application_id?: string) {
    super(
      {
        application_id,
        log_writer: new LogWriter(new TestLogger(), 'NodeConnectionTest'),
        keep_alive: {
          enabled: false,
        },
      } as NodeConnectionParams,
      {} as Http.Agent,
    )
  }
  protected createClientRequest(): Http.ClientRequest {
    return {} as any
  }
  public getDefaultHeaders() {
    return this.headers
  }
}
