import type {
  ConnectionParams,
  ConnQueryResult,
} from '@clickhouse/client-common'
import { LogWriter } from '@clickhouse/client-common'
import { guid, sleep, TestLogger, validateUUID } from '@test/utils'
import { randomUUID } from '@test/utils/guid'
import type { ClientRequest } from 'http'
import Http from 'http'
import Stream from 'stream'
import Util from 'util'
import Zlib from 'zlib'
import type { NodeConnectionParams } from '../../src/connection'
import { NodeBaseConnection, NodeHttpConnection } from '../../src/connection'
import { getAsText } from '../../src/utils'

describe('[Node.js] HttpAdapter', () => {
  const gzip = Util.promisify(Zlib.gzip)

  describe('compression', () => {
    describe('response decompression', () => {
      it('hints ClickHouse server to send a gzip compressed response if compress_request: true', async () => {
        const request = stubClientRequest()
        const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)

        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        const responseBody = 'foobar'
        await emitCompressedBody(request, responseBody)

        await selectPromise

        expect(httpRequestStub).toHaveBeenCalledTimes(1)
        const calledWith = httpRequestStub.calls.mostRecent().args[1]
        expect(calledWith.headers!['Accept-Encoding']).toBe('gzip')
      })

      it('does not send a compression algorithm hint if compress_request: false', async () => {
        const request = stubClientRequest()
        const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
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

        const queryResult = await selectPromise
        await assertQueryResult(queryResult, responseBody)

        expect(httpRequestStub).toHaveBeenCalledTimes(1)
        const calledWith = httpRequestStub.calls.mostRecent().args[1]
        expect(calledWith.headers!['Accept-Encoding']).toBeUndefined()
      })

      it('uses request-specific settings over config settings', async () => {
        const request = stubClientRequest()
        const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        })

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
          clickhouse_settings: {
            enable_http_compression: 1,
          },
        })

        const responseBody = 'foobar'
        await emitCompressedBody(request, responseBody)

        const queryResult = await selectPromise
        await assertQueryResult(queryResult, responseBody)

        expect(httpRequestStub).toHaveBeenCalledTimes(1)
        const calledWith = httpRequestStub.calls.mostRecent().args[1]
        expect(calledWith.headers!['Accept-Encoding']).toBe('gzip')
      })

      it('decompresses a gzip response', async () => {
        const request = stubClientRequest()
        spyOn(Http, 'request').and.returnValue(request)
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        const responseBody = 'abc'.repeat(1_000)
        await emitCompressedBody(request, responseBody)

        const queryResult = await selectPromise
        await assertQueryResult(queryResult, responseBody)
      })

      it('throws on an unexpected encoding', async () => {
        const request = stubClientRequest()
        spyOn(Http, 'request').and.returnValue(request)
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        await emitCompressedBody(request, 'abc', 'br')

        await expectAsync(selectPromise).toBeRejectedWith(
          jasmine.objectContaining({
            message: 'Unexpected encoding: br',
          })
        )
      })

      it('provides decompression error to a stream consumer', async () => {
        const request = stubClientRequest()
        spyOn(Http, 'request').and.returnValue(request)
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        // No GZIP encoding for the body here
        request.emit(
          'response',
          buildIncomingMessage({
            body: 'abc',
            headers: {
              'content-encoding': 'gzip',
            },
          })
        )

        const readStream = async () => {
          const { stream } = await selectPromise
          for await (const chunk of stream) {
            void chunk // stub
          }
        }

        await expectAsync(readStream()).toBeRejectedWith(
          jasmine.objectContaining({
            message: 'incorrect header check',
            code: 'Z_DATA_ERROR',
          })
        )
      })
    })

    describe('request compression', () => {
      it('sends a compressed request if compress_request: true', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: true,
          },
        })

        const values = 'abc'.repeat(1_000)

        let chunks = Buffer.alloc(0)
        let finalResult: Buffer | undefined = undefined
        const request = new Stream.Writable({
          write(chunk, encoding, next) {
            chunks = Buffer.concat([chunks, chunk])
            next()
          },
          final() {
            Zlib.unzip(chunks, (err, result) => {
              finalResult = result
            })
          },
        }) as ClientRequest

        const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)

        void adapter.insert({
          query: 'INSERT INTO insert_compression_table',
          values,
        })

        // trigger stream pipeline
        request.emit('socket', {
          setTimeout: () => {
            //
          },
        })

        await sleep(100)
        expect(finalResult!.toString('utf8')).toEqual(values)
        expect(httpRequestStub).toHaveBeenCalledTimes(1)
        const calledWith = httpRequestStub.calls.mostRecent().args[1]
        expect(calledWith.headers!['Content-Encoding']).toBe('gzip')
      })
    })

    async function emitCompressedBody(
      request: ClientRequest,
      body: string,
      encoding = 'gzip'
    ) {
      const compressedBody = await gzip(body)
      request.emit(
        'response',
        buildIncomingMessage({
          body: compressedBody,
          headers: {
            'content-encoding': encoding,
          },
        })
      )
    }
  })

  describe('User-Agent', () => {
    it('should have proper user agent without app id', async () => {
      const myHttpAdapter = new MyTestHttpAdapter()
      const headers = myHttpAdapter.getDefaultHeaders()
      expect(headers['User-Agent']).toMatch(
        /^clickhouse-js\/[0-9\\.]+-?(?:(alpha|beta)\d*)? \(lv:nodejs\/v[0-9\\.]+?; os:(?:linux|darwin|win32)\)$/
      )
    })

    it('should have proper user agent with app id', async () => {
      const myHttpAdapter = new MyTestHttpAdapter('MyFancyApp')
      const headers = myHttpAdapter.getDefaultHeaders()
      expect(headers['User-Agent']).toMatch(
        /^MyFancyApp clickhouse-js\/[0-9\\.]+-?(?:(alpha|beta)\d*)? \(lv:nodejs\/v[0-9\\.]+?; os:(?:linux|darwin|win32)\)$/
      )
    })
  })

  it('should have proper auth header', async () => {
    const myHttpAdapter = new MyTestHttpAdapter()
    const headers = myHttpAdapter.getDefaultHeaders()
    expect(headers['Authorization']).toMatch(/^Basic [A-Za-z0-9/+=]+$/)
  })

  describe('query_id', () => {
    it('should generate random query_id for each query', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')

      const request1 = stubClientRequest()
      httpRequestStub.and.returnValue(request1)

      const selectPromise1 = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      const responseBody1 = 'foobar'
      request1.emit(
        'response',
        buildIncomingMessage({
          body: responseBody1,
        })
      )
      const queryResult1 = await selectPromise1

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const selectPromise2 = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      const responseBody2 = 'qaz'
      request2.emit(
        'response',
        buildIncomingMessage({
          body: responseBody2,
        })
      )
      const queryResult2 = await selectPromise2

      await assertQueryResult(queryResult1, responseBody1)
      await assertQueryResult(queryResult2, responseBody2)
      expect(queryResult1.query_id).not.toEqual(queryResult2.query_id)

      const url1 = httpRequestStub.calls.all()[0].args[0]
      expect(url1.search).toContain(`&query_id=${queryResult1.query_id}`)

      const url2 = httpRequestStub.calls.all()[1].args[0]
      expect(url2.search).toContain(`&query_id=${queryResult2.query_id}`)
    })

    it('should use provided query_id for query', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const request = stubClientRequest()
      const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)

      const query_id = guid()
      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        query_id,
      })
      const responseBody = 'foobar'
      request.emit(
        'response',
        buildIncomingMessage({
          body: responseBody,
        })
      )
      const { stream } = await selectPromise
      expect(await getAsText(stream)).toBe(responseBody)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`&query_id=${query_id}`)
    })

    it('should generate random query_id for every exec request', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')

      const request1 = stubClientRequest()
      httpRequestStub.and.returnValue(request1)

      const execPromise1 = adapter.exec({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      const responseBody1 = 'foobar'
      request1.emit(
        'response',
        buildIncomingMessage({
          body: responseBody1,
        })
      )
      const queryResult1 = await execPromise1

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const execPromise2 = adapter.exec({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      const responseBody2 = 'qaz'
      request2.emit(
        'response',
        buildIncomingMessage({
          body: responseBody2,
        })
      )
      const queryResult2 = await execPromise2

      await assertQueryResult(queryResult1, responseBody1)
      await assertQueryResult(queryResult2, responseBody2)
      expect(queryResult1.query_id).not.toEqual(queryResult2.query_id)

      const [url1] = httpRequestStub.calls.all()[0].args
      expect(url1.search).toContain(`&query_id=${queryResult1.query_id}`)

      const [url2] = httpRequestStub.calls.all()[1].args
      expect(url2.search).toContain(`&query_id=${queryResult2.query_id}`)
    })

    it('should use provided query_id for exec', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)

      const query_id = guid()
      const execPromise = adapter.exec({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        query_id,
      })
      const responseBody = 'foobar'
      request.emit(
        'response',
        buildIncomingMessage({
          body: responseBody,
        })
      )
      const { stream } = await execPromise
      expect(await getAsText(stream)).toBe(responseBody)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`&query_id=${query_id}`)
    })

    it('should generate random query_id for every insert request', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')

      const request1 = stubClientRequest()
      httpRequestStub.and.returnValue(request1)

      const insertPromise1 = adapter.insert({
        query: 'INSERT INTO default.foo VALUES (42)',
        values: 'foobar',
      })
      const responseBody1 = 'foobar'
      request1.emit(
        'response',
        buildIncomingMessage({
          body: responseBody1,
        })
      )
      const { query_id: queryId1 } = await insertPromise1

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const insertPromise2 = adapter.insert({
        query: 'INSERT INTO default.foo VALUES (42)',
        values: 'foobar',
      })
      const responseBody2 = 'qaz'
      request2.emit(
        'response',
        buildIncomingMessage({
          body: responseBody2,
        })
      )
      const { query_id: queryId2 } = await insertPromise2

      assertQueryId(queryId1)
      assertQueryId(queryId2)
      expect(queryId1).not.toEqual(queryId2)

      const [url1] = httpRequestStub.calls.all()[0].args
      expect(url1.search).toContain(`&query_id=${queryId1}`)

      const [url2] = httpRequestStub.calls.all()[1].args
      expect(url2.search).toContain(`&query_id=${queryId2}`)
    })

    it('should use provided query_id for insert', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const request = stubClientRequest()
      const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)

      const query_id = guid()
      const insertPromise1 = adapter.insert({
        query: 'INSERT INTO default.foo VALUES (42)',
        values: 'foobar',
        query_id,
      })
      const responseBody1 = 'foobar'
      request.emit(
        'response',
        buildIncomingMessage({
          body: responseBody1,
        })
      )
      await insertPromise1

      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`&query_id=${query_id}`)
    })
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
        url: new URL('http://localhost:8132'),

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

  async function assertQueryResult(
    { stream, query_id }: ConnQueryResult<Stream.Readable>,
    expectedResponseBody: any
  ) {
    expect(await getAsText(stream)).toBe(expectedResponseBody)
    assertQueryId(query_id)
  }

  function assertQueryId(query_id: string) {
    expect(typeof query_id).toBe('string')
    expect(validateUUID(query_id)).toBeTruthy()
  }
})

class MyTestHttpAdapter extends NodeBaseConnection {
  constructor(application_id?: string) {
    super(
      {
        application_id,
        logWriter: new LogWriter(new TestLogger()),
        keep_alive: {
          enabled: true,
          socket_ttl: 2500,
          retry_on_expired_socket: true,
        },
      } as NodeConnectionParams,
      {} as Http.Agent
    )
  }
  protected createClientRequest(): Http.ClientRequest {
    return {} as any
  }
  public getDefaultHeaders() {
    return this.headers
  }
}
