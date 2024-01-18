import { createClient } from '../../src'
import type { WebClickHouseClient } from '../../src/client'

describe('[Web] Connection', () => {
  describe('additional_headers', () => {
    let fetchSpy: jasmine.Spy<typeof window.fetch>
    beforeEach(() => {
      fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response())
      )
    })

    it('should be possible to set', async () => {
      const client = createClient({
        additional_headers: {
          'Test-Header': 'default',
        },
      })
      const fetchParams = await pingAndGetRequestInit(client)
      expect(fetchParams!.headers?.['Test-Header']).toBe('default')

      async function pingAndGetRequestInit(client: WebClickHouseClient) {
        await client.ping()
        expect(fetchSpy).toHaveBeenCalledTimes(1)
        const [, fetchParams] = fetchSpy.calls.mostRecent().args
        return fetchParams!
      }
    })
  })

  describe('KeepAlive setting', () => {
    let fetchSpy: jasmine.Spy<typeof window.fetch>
    beforeEach(() => {
      fetchSpy = spyOn(window, 'fetch').and.returnValue(
        Promise.resolve(new Response())
      )
    })

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

    async function pingAndGetRequestInit(client: WebClickHouseClient) {
      await client.ping()
      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const [, fetchParams] = fetchSpy.calls.mostRecent().args
      return fetchParams!
    }
  })
})
