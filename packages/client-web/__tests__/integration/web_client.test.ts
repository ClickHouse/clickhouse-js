import { createClient } from '../../src'
import type { WebClickHouseClient } from '../../src/client'

describe('[Web] Client', () => {
  let fetchSpy: jasmine.Spy<typeof window.fetch>
  beforeEach(() => {
    fetchSpy = spyOn(window, 'fetch').and.returnValue(
      Promise.resolve(new Response()),
    )
  })

  describe('HTTP headers', () => {
    it('should be possible to set', async () => {
      const client = createClient({
        http_headers: {
          'Test-Header': 'foobar',
        },
      })
      const fetchParams = await pingAndGetRequestInit(client)
      expect(fetchParams!.headers).toEqual({
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
        'Test-Header': 'foobar',
      })
    })

    it('should work with no additional HTTP headers provided', async () => {
      const client = createClient({})
      const fetchParams = await pingAndGetRequestInit(client)
      expect(fetchParams!.headers).toEqual({
        Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
      })
    })
  })

  describe('KeepAlive setting', () => {
    it('should be enabled by default', async () => {
      const client = createClient()
      const fetchParams = await pingAndGetRequestInit(client)
      expect(fetchParams.keepalive).toBeTruthy()
    })

    it('should be possible to disable it', async () => {
      const client = createClient({ keep_alive: { enabled: false } })
      const fetchParams = await pingAndGetRequestInit(client)
      expect(fetchParams!.keepalive).toBeFalsy()
    })

    it('should be enabled with an explicit setting', async () => {
      const client = createClient({ keep_alive: { enabled: true } })
      const fetchParams = await pingAndGetRequestInit(client)
      expect(fetchParams.keepalive).toBeTruthy()
    })
  })

  async function pingAndGetRequestInit(client: WebClickHouseClient) {
    await client.ping()
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [, fetchParams] = fetchSpy.calls.mostRecent().args
    return fetchParams!
  }
})
