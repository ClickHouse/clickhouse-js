import Http from 'http'
import type Stream from 'stream'
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

  describe('Additional headers', () => {
    it('should be possible to set additional_headers', async () => {
      const client = createClient({
        additional_headers: {
          'Test-Header': 'foobar',
        },
      })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
      expect(callOptions.headers).toEqual({
        'Accept-Encoding': 'gzip',
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'Test-Header': 'foobar',
        'User-Agent': jasmine.stringContaining('clickhouse-js'),
      })
      assertSearchParams(callURL)
    })

    it('should work without additional headers', async () => {
      const client = createClient({})
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
      expect(callOptions.headers).toEqual({
        'Accept-Encoding': 'gzip',
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'User-Agent': jasmine.stringContaining('clickhouse-js'),
      })
      assertSearchParams(callURL)
    })
  })

  describe('Readonly switch', () => {
    it('should disable certain settings by default for a read-only user', async () => {
      const client = createClient({ readonly: true })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
      expect(callOptions.headers).toEqual({
        // no GZIP header
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'User-Agent': jasmine.stringContaining('clickhouse-js'),
      })
      assertReadOnlySearchParams(callURL)
    })

    it('should behave like default with an explicit false', async () => {
      const client = createClient({ readonly: false })
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const [callURL, callOptions] = httpRequestStub.calls.mostRecent().args
      expect(callOptions.headers).toEqual({
        'Accept-Encoding': 'gzip',
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'User-Agent': jasmine.stringContaining('clickhouse-js'),
      })
      assertSearchParams(callURL)
    })
  })

  async function query(client: ClickHouseClient<Stream.Readable>) {
    const selectPromise = client.query({
      query: 'SELECT * FROM system.numbers LIMIT 5',
    })
    emitResponseBody(clientRequest, 'hi')
    await selectPromise
  }

  function assertSearchParams(callURL: string | URL) {
    const searchParams = new URL(callURL).search.slice(1).split('&')
    expect(searchParams).toContain('enable_http_compression=1')
    expect(searchParams).toContain('send_progress_in_http_headers=1')
    expect(searchParams).toContain('http_headers_progress_interval_ms=20000')
    expect(searchParams).toContain(jasmine.stringContaining('query_id='))
    expect(searchParams.length).toEqual(4)
  }

  function assertReadOnlySearchParams(callURL: string | URL) {
    const searchParams = new URL(callURL).search.slice(1).split('&')
    expect(searchParams).toContain(jasmine.stringContaining('query_id='))
    expect(searchParams.length).toEqual(1) // No compression or HTTP settings
  }
})