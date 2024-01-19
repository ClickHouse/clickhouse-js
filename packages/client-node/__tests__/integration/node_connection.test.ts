import type { ConnectionParams } from '@clickhouse/client-common'
import { LogWriter } from '@clickhouse/client-common'
import { TestLogger } from '@test/utils'
import { randomUUID } from '@test/utils/guid'
import type { ClientRequest } from 'http'
import Http from 'http'
import Stream from 'stream'
import { NodeHttpConnection } from '../../src/connection'

describe('[Node.js] Connection', () => {
  it('should be possible to set additional_headers', async () => {
    const request = stubClientRequest()
    const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)
    const adapter = buildHttpAdapter({
      additional_headers: {
        'Test-Header': 'default',
      },
    })

    const selectPromise = adapter.query({
      query: 'SELECT * FROM system.numbers LIMIT 5',
    })

    const responseBody = 'foobar'
    request.emit(
      'response',
      buildIncomingMessage({
        body: responseBody,
      })
    )

    await selectPromise

    expect(httpRequestStub).toHaveBeenCalledTimes(1)
    const calledWith = httpRequestStub.calls.mostRecent().args[1]
    expect(calledWith.headers?.['Test-Header']).toBe('default')
  })

  function buildIncomingMessage({
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

  function stubClientRequest() {
    const request = new Stream.Writable({
      write() {
        /** stub */
      },
    }) as ClientRequest
    request.getHeaders = () => ({})
    return request
  }

  function buildHttpAdapter(config: Partial<ConnectionParams>) {
    return new NodeHttpConnection({
      ...{
        url: new URL('http://localhost:8123'),

        connect_timeout: 10_000,
        request_timeout: 30_000,
        compression: {
          decompress_response: true,
          compress_request: false,
        },
        max_open_connections: Infinity,

        username: '',
        password: '',
        database: '',
        clickhouse_settings: {},
        additional_headers: {},

        logWriter: new LogWriter(new TestLogger()),
        keep_alive: {
          enabled: true,
          socket_ttl: 2500,
          retry_on_expired_socket: false,
        },
      },
      ...config,
    })
  }
})
