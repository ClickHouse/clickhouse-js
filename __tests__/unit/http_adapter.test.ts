import type { ClientRequest } from 'http'
import Http from 'http'
import Stream from 'stream'
import Util from 'util'
import Zlib from 'zlib'
import type { ConnectionParams, QueryResult } from '../../src/connection'
import { HttpAdapter } from '../../src/connection/adapter'
import { guid, retryOnFailure, TestLogger } from '../utils'
import { getAsText } from '../../src/utils'
import { LogWriter } from '../../src/logger'
import * as uuid from 'uuid'
import { v4 as uuid_v4 } from 'uuid'
import { BaseHttpAdapter } from '../../src/connection/adapter/base_http_adapter'

describe('HttpAdapter', () => {
  const gzip = Util.promisify(Zlib.gzip)
  const httpRequestStub = jest.spyOn(Http, 'request')

  describe('compression', () => {
    describe('response decompression', () => {
      it('hints ClickHouse server to send a gzip compressed response if compress_request: true', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })

        const request = stubRequest()

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        const responseBody = 'foobar'
        await emitCompressedBody(request, responseBody)

        await selectPromise
        assertStub('gzip')
      })

      it('does not send a compression algorithm hint if compress_request: false', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        })
        const request = stubRequest()

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
        assertStub(undefined)
      })

      it('uses request-specific settings over config settings', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        })
        const request = stubRequest()

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
        assertStub('gzip')
      })

      it('decompresses a gzip response', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })
        const request = stubRequest()

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        const responseBody = 'abc'.repeat(1_000)
        await emitCompressedBody(request, responseBody)

        const queryResult = await selectPromise
        await assertQueryResult(queryResult, responseBody)
      })

      it('throws on an unexpected encoding', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })
        const request = stubRequest()

        const selectPromise = adapter.query({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        })

        await emitCompressedBody(request, 'abc', 'br')

        await expect(selectPromise).rejects.toMatchObject({
          message: 'Unexpected encoding: br',
        })
      })

      it('provides decompression error to a stream consumer', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        })
        const request = stubRequest()

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

        await expect(async () => {
          const { stream } = await selectPromise
          for await (const chunk of stream) {
            void chunk // stub
          }
        }).rejects.toMatchObject({
          message: 'incorrect header check',
          code: 'Z_DATA_ERROR',
        })
      })

      function assertStub(encoding: string | undefined) {
        expect(httpRequestStub).toBeCalledTimes(1)
        const calledWith = httpRequestStub.mock.calls[0][1]
        expect(calledWith.headers!['Accept-Encoding']).toBe(encoding)
      }
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

        httpRequestStub.mockReturnValueOnce(request)

        void adapter.insert({
          query: 'INSERT INTO insert_compression_table',
          values,
        })

        await retryOnFailure(async () => {
          expect(finalResult!.toString('utf8')).toEqual(values)
        })
        assertStub('gzip')
      })

      function assertStub(encoding: string | undefined) {
        expect(httpRequestStub).toBeCalledTimes(1)
        const calledWith = httpRequestStub.mock.calls[0][1]
        expect(calledWith.headers!['Content-Encoding']).toBe(encoding)
      }
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
        /^clickhouse-js\/[0-9\\.]+? \(lv:nodejs\/v[0-9\\.]+?; os:(?:linux|darwin|win32)\)$/
      )
    })

    it('should have proper user agent with app id', async () => {
      const myHttpAdapter = new MyTestHttpAdapter('MyFancyApp')
      const headers = myHttpAdapter.getDefaultHeaders()
      expect(headers['User-Agent']).toMatch(
        /^MyFancyApp clickhouse-js\/[0-9\\.]+? \(lv:nodejs\/v[0-9\\.]+?; os:(?:linux|darwin|win32)\)$/
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
      const request1 = stubRequest()

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

      const request2 = stubRequest()
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

      const url1 = httpRequestStub.mock.calls[0][0]
      expect(url1.search).toContain(`&query_id=${queryResult1.query_id}`)

      const url2 = httpRequestStub.mock.calls[1][0]
      expect(url2.search).toContain(`&query_id=${queryResult2.query_id}`)
    })

    it('should use provided query_id for query', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })
      const request = stubRequest()

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

      expect(httpRequestStub).toBeCalledTimes(1)
      const [url] = httpRequestStub.mock.calls[0]
      expect(url.search).toContain(`&query_id=${query_id}`)
    })

    it('should generate random query_id for every exec request', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })
      const request1 = stubRequest()

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

      const request2 = stubRequest()
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

      const url1 = httpRequestStub.mock.calls[0][0]
      expect(url1.search).toContain(`&query_id=${queryResult1.query_id}`)

      const url2 = httpRequestStub.mock.calls[1][0]
      expect(url2.search).toContain(`&query_id=${queryResult2.query_id}`)
    })

    it('should use provided query_id for exec', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })
      const request = stubRequest()

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

      expect(httpRequestStub).toBeCalledTimes(1)
      const [url] = httpRequestStub.mock.calls[0]
      expect(url.search).toContain(`&query_id=${query_id}`)
    })

    it('should generate random query_id for every insert request', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })
      const request1 = stubRequest()

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

      const request2 = stubRequest()
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

      const url1 = httpRequestStub.mock.calls[0][0]
      expect(url1.search).toContain(`&query_id=${queryId1}`)

      const url2 = httpRequestStub.mock.calls[1][0]
      expect(url2.search).toContain(`&query_id=${queryId2}`)
    })

    it('should use provided query_id for insert', async () => {
      const adapter = buildHttpAdapter({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })
      const request1 = stubRequest()

      const query_id = guid()
      const insertPromise1 = adapter.insert({
        query: 'INSERT INTO default.foo VALUES (42)',
        values: 'foobar',
        query_id,
      })
      const responseBody1 = 'foobar'
      request1.emit(
        'response',
        buildIncomingMessage({
          body: responseBody1,
        })
      )
      await insertPromise1

      const [url] = httpRequestStub.mock.calls[0]
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
      'x-clickhouse-query-id': uuid_v4(),
      ...headers,
    }
    return response
  }

  function stubRequest() {
    const request = new Stream.Writable({
      write() {
        /** stub */
      },
    }) as ClientRequest
    request.getHeaders = () => ({})
    httpRequestStub.mockReturnValueOnce(request)
    return request
  }

  function buildHttpAdapter(config: Partial<ConnectionParams>) {
    return new HttpAdapter(
      {
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
        },
        ...config,
      },
      new LogWriter(new TestLogger())
    )
  }

  async function assertQueryResult(
    { stream, query_id }: QueryResult,
    expectedResponseBody: any
  ) {
    expect(await getAsText(stream)).toBe(expectedResponseBody)
    assertQueryId(query_id)
  }

  function assertQueryId(query_id: string) {
    expect(typeof query_id).toBe('string')
    expect(uuid.validate(query_id)).toBeTruthy()
  }
})

class MyTestHttpAdapter extends BaseHttpAdapter {
  constructor(application_id?: string) {
    super(
      { application_id } as ConnectionParams,
      new TestLogger(),
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
