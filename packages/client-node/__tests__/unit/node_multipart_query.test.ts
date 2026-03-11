import { describe, it, expect, beforeEach, vi } from 'vitest'
import Http from 'http'
import {
  buildHttpConnection,
  emitResponseBody,
  stubClientRequest,
} from '../utils/http_stubs'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('[Node.js] Multipart query params', () => {
  describe('when use_multipart_params is true', () => {
    it('should move query_params from URL into multipart body parts', async () => {
      const adapter = buildHttpConnection({
        use_multipart_params: true,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const query = 'SELECT * FROM t WHERE x IN {values:Array(String)}'
      const selectPromise = adapter.query({
        query,
        query_params: {
          values: ['a@b.com', 'c@d.com'],
        },
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      // URL should NOT contain param_values
      const [url, options] = httpRequestStub.mock.calls[0]
      expect(url.search).not.toContain('param_values')
      expect(url.search).toContain('query_id=')

      // Content-Type should be multipart/form-data with a boundary
      expect(options.headers['Content-Type']).toMatch(
        /^multipart\/form-data; boundary=/,
      )
    })

    it('should set Content-Type with a boundary when using multipart', async () => {
      const adapter = buildHttpConnection({
        use_multipart_params: true,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const selectPromise = adapter.query({
        query: 'SELECT * FROM t WHERE x = {v:String}',
        query_params: { v: 'hello' },
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      const [_url, options] = httpRequestStub.mock.calls[0]
      const contentType = options.headers['Content-Type'] as string
      expect(contentType).toBeDefined()
      // Boundary should contain the clickhouse-js prefix
      expect(contentType).toMatch(
        /^multipart\/form-data; boundary=----clickhouse-js-/,
      )
    })

    it('should keep non-param search params (database, query_id, session_id, settings) in URL', async () => {
      const adapter = buildHttpConnection({
        database: 'my_db',
        compression: {
          decompress_response: false,
          compress_request: false,
        },
        use_multipart_params: true,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const selectPromise = adapter.query({
        query: 'SELECT {v:Int32}',
        query_params: { v: 42 },
        session_id: 'my-session',
        clickhouse_settings: {
          extremes: 1,
        },
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      const [url] = httpRequestStub.mock.calls[0]
      const search = url.search as string
      expect(search).toContain('query_id=')
      expect(search).toContain('database=my_db')
      expect(search).toContain('extremes=1')
      expect(search).toContain('session_id=my-session')
      // param_v should NOT be in URL
      expect(search).not.toContain('param_v')
    })

    it('should not include param entries in URL when multiple params are provided', async () => {
      const adapter = buildHttpConnection({
        use_multipart_params: true,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const selectPromise = adapter.query({
        query: 'SELECT {a:Int32}, {b:String}, {c:Array(String)}',
        query_params: {
          a: 1,
          b: 'two',
          c: ['x', 'y', 'z'],
        },
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      const [url] = httpRequestStub.mock.calls[0]
      const search = url.search as string
      expect(search).not.toContain('param_a')
      expect(search).not.toContain('param_b')
      expect(search).not.toContain('param_c')
    })

    it('should fall back to normal behavior when query_params is undefined', async () => {
      const adapter = buildHttpConnection({
        use_multipart_params: true,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const selectPromise = adapter.query({
        query: 'SELECT 1',
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      const [_url, options] = httpRequestStub.mock.calls[0]
      // Should NOT use multipart when there are no query_params
      expect(options.headers['Content-Type']).toBeUndefined()
    })

    it('should fall back to normal behavior when query_params is empty object', async () => {
      const adapter = buildHttpConnection({
        use_multipart_params: true,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const selectPromise = adapter.query({
        query: 'SELECT 1',
        query_params: {},
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      const [_url, options] = httpRequestStub.mock.calls[0]
      // Should NOT use multipart when query_params is empty
      expect(options.headers['Content-Type']).toBeUndefined()
    })
  })

  describe('when use_multipart_params is false (default)', () => {
    it('should send query_params as URL search params', async () => {
      const adapter = buildHttpConnection({
        use_multipart_params: false,
      })

      const request = stubClientRequest()
      const httpRequestStub = vi.spyOn(Http, 'request').mockReturnValue(request)

      const selectPromise = adapter.query({
        query: 'SELECT {v:Int32}',
        query_params: { v: 42 },
      })
      await emitResponseBody(request, 'ok')
      await selectPromise

      const [url, options] = httpRequestStub.mock.calls[0]
      // param_v should be in URL
      expect(url.search).toContain('param_v=42')
      // Should NOT set multipart content type
      expect(options.headers['Content-Type']).toBeUndefined()
    })
  })
})
