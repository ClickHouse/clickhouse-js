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
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(calledWith.headers).toEqual({
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'Accept-Encoding': 'gzip',
        'Test-Header': 'foobar',
        'User-Agent': jasmine.stringContaining('clickhouse-js'),
      })
    })

    it('should work without additional headers', async () => {
      const client = createClient({})
      await query(client)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(calledWith.headers).toEqual({
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'Accept-Encoding': 'gzip',
        'User-Agent': jasmine.stringContaining('clickhouse-js'),
      })
    })
  })

  async function query(client: ClickHouseClient<Stream.Readable>) {
    const selectPromise = client.query({
      query: 'SELECT * FROM system.numbers LIMIT 5',
    })
    emitResponseBody(clientRequest, 'hi')
    await selectPromise
  }
})
