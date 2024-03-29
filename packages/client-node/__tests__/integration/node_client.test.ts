import Http from 'http'
import type { ClickHouseClient } from '../../src'
import { createClient } from '../../src'
import { emitResponseBody, stubClientRequest } from '../utils/http_stubs'

describe('[Node.js] Client', () => {
  let httpRequestStub: jasmine.Spy<typeof Http.request>
  let clientRequest: Http.ClientRequest
  beforeEach(() => {
    clientRequest = stubClientRequest()
    httpRequestStub = spyOn(Http, 'request').and.returnValue(clientRequest)
  })

  describe('Connection header (KeepAlive)', () => {
    it('should set "keep-alive" by default', async () => {
      const client = createClient({})
      await query(client)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(calledWith.headers!['Connection']).toEqual('keep-alive')
    })

    it('should set "close" when KeepAlive is disabled', async () => {
      const client = createClient({
        keep_alive: { enabled: false },
      })
      await query(client)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(calledWith.headers!['Connection']).toEqual('close')
    })

    it('should set "keep-alive" when KeepAlive is explicitly enabled', async () => {
      const client = createClient({
        keep_alive: { enabled: true },
      })
      await query(client)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(calledWith.headers!['Connection']).toEqual('keep-alive')
    })
  })

  describe('HTTP headers', () => {
    it('should be possible to set http_headers', async () => {
      const client = createClient({
        http_headers: {
          'Test-Header': 'foobar',
        },
      })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
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
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
      expect(callOptions.headers).toEqual(defaultHeaders)
      assertSearchParams(callURL)
    })
  })

  describe('Compression headers', () => {
    it('should disable response compression by default', async () => {
      const client = createClient()
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
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
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
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
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
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
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
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
    emitResponseBody(clientRequest, 'hi')
    await selectPromise
  }

  function assertSearchParams(callURL: string | URL) {
    const searchParams = new URL(callURL).searchParams
    expect(searchParams.get('query_id')).not.toBeNull()
    expect(searchParams.size).toEqual(1) // only query_id by default
  }

  const defaultHeaders: Record<
    string,
    string | jasmine.AsymmetricMatcher<string>
  > = {
    Connection: 'keep-alive',
    Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
    'User-Agent': jasmine.stringContaining('clickhouse-js'),
  }
})
