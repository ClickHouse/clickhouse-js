import { getHeadersTestParams } from '@test/utils/parametrized'
import Http from 'http'
import { vi, expect } from 'vitest'
import type { ClickHouseClient } from '../../src'
import { createClient } from '../../src'
import { emitResponseBody, stubClientRequest } from '../utils/http_stubs'

describe('[Node.js] Client', () => {
  let httpRequestStub: ReturnType<typeof vi.spyOn>
  let clientRequest: Http.ClientRequest
  beforeEach(() => {
    vi.clearAllMocks()
    clientRequest = stubClientRequest()
    httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(clientRequest)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Connection header (KeepAlive)', () => {
    it('should set "keep-alive" by default', async () => {
      const client = createClient({})
      await query(client)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.mock.lastCall![1]
      expect(
        (calledWith.headers as Record<string, string>)['Connection'],
      ).toEqual('keep-alive')
    })

    it('should set "close" when KeepAlive is disabled', async () => {
      const client = createClient({
        keep_alive: { enabled: false },
      })
      await query(client)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.mock.lastCall![1]
      expect(
        (calledWith.headers as Record<string, string>)['Connection'],
      ).toEqual('close')
    })

    it('should set "keep-alive" when KeepAlive is explicitly enabled', async () => {
      const client = createClient({
        keep_alive: { enabled: true },
      })
      await query(client)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.mock.lastCall![1]
      expect(
        (calledWith.headers as Record<string, string>)['Connection'],
      ).toEqual('keep-alive')
    })
  })

  describe('HTTP headers', () => {
    it('should be possible to set http_headers', async () => {
      const client = createClient({
        http_headers: {
          'Test-Header': 'foobar',
          Authorization: 'should-be-overridden-by-client-anyway',
        },
      })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.mock.lastCall!
      expect(callOptions.headers).toEqual({
        ...defaultHeaders,
        'Test-Header': 'foobar',
      })
      assertSearchParams(callURL)
    })

    it('should work without additional HTTP headers', async () => {
      const client = createClient({})
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.mock.lastCall!
      expect(callOptions.headers).toEqual(defaultHeaders)
      assertSearchParams(callURL)
    })

    it('should work with additional HTTP headers on the method level', async () => {
      const client = createClient({
        http_headers: {
          FromInstance: 'foo',
          Authorization: 'should-be-overridden-by-client-anyway',
        },
      })

      async function withEmit(method: () => Promise<unknown>) {
        const promise = method()
        await emitResponseBody(clientRequest, 'hi')
        await promise
      }

      let requestCalls = 1
      const testParams = getHeadersTestParams(client)
      for (const param of testParams) {
        await withEmit(() => param.methodCall({ FromMethod: 'bar' }))
        // ${param.methodName}: merges custom HTTP headers from both method and instance
        expect(
          getRequestHeaders(requestCalls++),
          `${param.methodName}: merges custom HTTP headers from both method and instance`,
        ).toEqual({
          ...defaultHeaders,
          FromInstance: 'foo',
          FromMethod: 'bar',
        })

        await withEmit(() => param.methodCall({ FromInstance: 'bar' }))
        // ${param.methodName}: overrides HTTP headers from the instance with the values from the method call
        expect(
          getRequestHeaders(requestCalls++),
          `${param.methodName}: overrides HTTP headers from the instance with the values from the method call`,
        ).toEqual({
          ...defaultHeaders,
          FromInstance: 'bar',
        })
      }
    })
  })

  describe('Compression headers', () => {
    it('should disable response compression by default', async () => {
      const client = createClient()
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.mock.lastCall!
      expect(callOptions.headers).toEqual(defaultHeaders)
      assertSearchParams(callURL)
    })

    it('should enable response compression only', async () => {
      const client = createClient({
        compression: {
          response: true,
        },
      })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.mock.lastCall!
      assertCompressionRequestHeaders(callURL, callOptions)
    })

    it('should enable request compression only', async () => {
      const client = createClient({
        compression: {
          request: true,
          response: false,
        },
      })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.mock.lastCall!
      // no additional request headers in this case
      expect(callOptions.headers).toEqual(defaultHeaders)
      assertSearchParams(callURL)
    })

    it('should enable both request and response compression', async () => {
      const client = createClient({
        compression: {
          request: true,
          response: true,
        },
      })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.mock.lastCall!
      assertCompressionRequestHeaders(callURL, callOptions)
    })

    function assertCompressionRequestHeaders(
      callURL: string | URL,
      callOptions: Http.RequestOptions,
    ) {
      expect(callOptions.headers).toEqual({
        ...defaultHeaders,
        'Accept-Encoding': 'gzip',
      })

      const searchParams = new URL(callURL).searchParams
      expect(searchParams.get('enable_http_compression')).toEqual('1')
      expect(searchParams.get('query_id')).not.toBeNull()
      expect(searchParams.size).toEqual(2)
    }
  })

  async function query(client: ClickHouseClient) {
    const selectPromise = client.query({
      query: 'SELECT * FROM system.numbers LIMIT 5',
    })
    await emitResponseBody(clientRequest, 'hi')
    await selectPromise
  }

  function assertSearchParams(callURL: string | URL) {
    const searchParams = new URL(callURL).searchParams
    expect(searchParams.get('query_id')).not.toBeNull()
    expect(searchParams.size).toEqual(1) // only query_id by default
  }

  function getRequestHeaders(httpRequestStubCalledTimes = 1) {
    expect(httpRequestStub).toHaveBeenCalledTimes(httpRequestStubCalledTimes)
    const [, callOptions] = httpRequestStub.mock.lastCall!
    return callOptions.headers
  }

  const defaultHeaders: Record<string, string | any> = {
    Connection: 'keep-alive',
    Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
    'User-Agent': expect.stringContaining('clickhouse-js'),
  }
})
