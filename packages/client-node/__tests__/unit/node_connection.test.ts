import { guid } from '@test/utils'
import Http from 'http'
import { getAsText } from '../../src/utils'
import { assertQueryId, assertConnQueryResult } from '../utils/assert'
import {
  buildHttpConnection,
  emitResponseBody,
  MyTestHttpConnection,
  stubClientRequest,
} from '../utils/http_stubs'

describe('[Node.js] Connection', () => {
  describe('User-Agent', () => {
    it('should have proper user agent without app id', async () => {
      const myHttpAdapter = new MyTestHttpConnection()
      const headers = myHttpAdapter.getDefaultHeaders()
      expect(headers['User-Agent']).toMatch(
        /^clickhouse-js\/[0-9\\.]+-?(?:(alpha|beta)\.\d*)? \(lv:nodejs\/v[0-9\\.]+?; os:(?:linux|darwin|win32)\)$/,
      )
    })

    it('should have proper user agent with app id', async () => {
      const myHttpAdapter = new MyTestHttpConnection('MyFancyApp')
      const headers = myHttpAdapter.getDefaultHeaders()
      expect(headers['User-Agent']).toMatch(
        /^MyFancyApp clickhouse-js\/[0-9\\.]+-?(?:(alpha|beta)\.\d*)? \(lv:nodejs\/v[0-9\\.]+?; os:(?:linux|darwin|win32)\)$/,
      )
    })
  })

  it('should have proper auth header', async () => {
    const myHttpAdapter = new MyTestHttpConnection()
    const headers = myHttpAdapter.getDefaultHeaders()
    expect(headers['Authorization']).toMatch(/^Basic [A-Za-z0-9/+=]+$/)
  })

  describe('query_id', () => {
    it('should generate random query_id for each query', async () => {
      const adapter = buildHttpConnection({
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
      await emitResponseBody(request1, responseBody1)
      const queryResult1 = await selectPromise1

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const selectPromise2 = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      const responseBody2 = 'qaz'
      await emitResponseBody(request2, responseBody2)
      const queryResult2 = await selectPromise2

      await assertConnQueryResult(queryResult1, responseBody1)
      await assertConnQueryResult(queryResult2, responseBody2)
      expect(queryResult1.query_id).not.toEqual(queryResult2.query_id)

      const url1 = httpRequestStub.calls.all()[0].args[0]
      expect(url1.search).toContain(`?query_id=${queryResult1.query_id}`)

      const url2 = httpRequestStub.calls.all()[1].args[0]
      expect(url2.search).toContain(`?query_id=${queryResult2.query_id}`)
    })

    it('should use provided query_id for query', async () => {
      const adapter = buildHttpConnection({
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
      await emitResponseBody(request, responseBody)
      const { stream } = await selectPromise
      expect(await getAsText(stream)).toBe(responseBody)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`?query_id=${query_id}`)
    })

    it('should generate random query_id for every exec request', async () => {
      const adapter = buildHttpConnection({
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
      await emitResponseBody(request1, responseBody1)
      const queryResult1 = await execPromise1

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const execPromise2 = adapter.exec({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      const responseBody2 = 'qaz'
      await emitResponseBody(request2, responseBody2)
      const queryResult2 = await execPromise2

      await assertConnQueryResult(queryResult1, responseBody1)
      await assertConnQueryResult(queryResult2, responseBody2)
      expect(queryResult1.query_id).not.toEqual(queryResult2.query_id)

      const [url1] = httpRequestStub.calls.all()[0].args

      expect(url1.search).toContain(`?query_id=${queryResult1.query_id}`)

      const [url2] = httpRequestStub.calls.all()[1].args
      expect(url2.search).toContain(`?query_id=${queryResult2.query_id}`)
    })

    it('should use provided query_id for exec', async () => {
      const adapter = buildHttpConnection({
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
      await emitResponseBody(request, responseBody)
      const { stream } = await execPromise
      expect(await getAsText(stream)).toBe(responseBody)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`?query_id=${query_id}`)
    })

    it('should generate random query_id for every command request', async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')

      const request1 = stubClientRequest()
      httpRequestStub.and.returnValue(request1)

      const cmdPromise = adapter.command({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      await emitResponseBody(request1, 'Ok.')
      const { query_id } = await cmdPromise

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const cmdPromise2 = adapter.command({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })
      await emitResponseBody(request2, 'Ok.')
      const { query_id: query_id2 } = await cmdPromise2

      expect(query_id).not.toEqual(query_id2)
      const [url1] = httpRequestStub.calls.all()[0].args
      expect(url1.search).toContain(`?query_id=${query_id}`)
      const [url2] = httpRequestStub.calls.all()[1].args
      expect(url2.search).toContain(`?query_id=${query_id2}`)
    })

    it('should use provided query_id for command', async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)

      const query_id = guid()
      const cmdPromise = adapter.command({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        query_id,
      })
      await emitResponseBody(request, 'Ok.')
      const { query_id: result_query_id } = await cmdPromise

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`?query_id=${query_id}`)
      expect(query_id).toEqual(result_query_id)
    })

    it('should generate random query_id for every insert request', async () => {
      const adapter = buildHttpConnection({
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
      await emitResponseBody(request1, responseBody1)
      const { query_id: queryId1 } = await insertPromise1

      const request2 = stubClientRequest()
      httpRequestStub.and.returnValue(request2)

      const insertPromise2 = adapter.insert({
        query: 'INSERT INTO default.foo VALUES (42)',
        values: 'foobar',
      })
      const responseBody2 = 'qaz'
      await emitResponseBody(request2, responseBody2)
      const { query_id: queryId2 } = await insertPromise2

      assertQueryId(queryId1)
      assertQueryId(queryId2)
      expect(queryId1).not.toEqual(queryId2)

      const [url1] = httpRequestStub.calls.all()[0].args
      expect(url1.search).toContain(`?query_id=${queryId1}`)

      const [url2] = httpRequestStub.calls.all()[1].args
      expect(url2.search).toContain(`?query_id=${queryId2}`)
    })

    it('should use provided query_id for insert', async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const request = stubClientRequest()
      const httpRequestStub = spyOn(Http, 'request').and.returnValue(request)

      const query_id = guid()
      const insertPromise = adapter.insert({
        query: 'INSERT INTO default.foo VALUES (42)',
        values: 'foobar',
        query_id,
      })
      const responseBody = 'foobar'
      await emitResponseBody(request, responseBody)
      await insertPromise

      const [url] = httpRequestStub.calls.mostRecent().args
      expect(url.search).toContain(`?query_id=${query_id}`)
    })
  })

  describe('opentelemetry_headers', () => {
    it('should set the traceparent and tracestate on request', async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const httpRequestStub = spyOn(Http, 'request')

      const request1 = stubClientRequest()
      httpRequestStub.and.returnValue(request1)

      const traceparent =
        '00-12345678901234567890123456789012-1234567890123456-01'

      const tracestate = 'rojo=00f067aa0ba902b7'

      const cmdPromise = adapter.command({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        opentelemetry_headers: { traceparent, tracestate },
      })
      await emitResponseBody(request1, 'Ok.')
      await cmdPromise

      const headers = httpRequestStub.calls.argsFor(0)[1].headers!

      expect(headers['traceparent']).toBe(traceparent)
      expect(headers['tracestate']).toBe(tracestate)
    })
  })
})
