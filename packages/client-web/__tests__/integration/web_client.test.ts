import { describe, it, expect, beforeEach, vi } from 'vitest'
import { getHeadersTestParams } from '@test/utils/parametrized'
import { createClient } from '../../src'

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
          Authorization: 'should-be-overridden-by-client-anyway',
        },
      })
      await client.ping()
      const fetchParams = getFetchRequestInit()
      expect(fetchParams!.headers).toEqual({
        ...defaultHeaders,
        'Test-Header': 'foobar',
      })
    })

    it('should work with no additional HTTP headers provided', async () => {
      const client = createClient({})
      await client.ping()
      const fetchParams = getFetchRequestInit()
      expect(fetchParams!.headers).toEqual(defaultHeaders)
    })

    it('should work with additional HTTP headers on the method level', async () => {
      const client = createClient({
        http_headers: {
          FromInstance: 'foo',
          Authorization: 'should-be-overridden-by-client-anyway',
        },
      })

      let fetchCalls = 1
      const testParams = getHeadersTestParams(client)
      for (const param of testParams) {
        await param.methodCall({ FromMethod: 'bar' })
        expect(getFetchRequestInit(fetchCalls++).headers)
          .withContext(
            `${param.methodName}: merges custom HTTP headers from both method and instance`,
          )
          .toEqual({
            ...defaultHeaders,
            FromInstance: 'foo',
            FromMethod: 'bar',
          })

        await param.methodCall({ FromInstance: 'bar' })
        expect(getFetchRequestInit(fetchCalls++).headers)
          .withContext(
            `${param.methodName}: overrides HTTP headers from the instance with the values from the method call`,
          )
          .toEqual({
            ...defaultHeaders,
            FromInstance: 'bar',
          })
      }
    })
  })

  describe('KeepAlive setting', () => {
    it('should be enabled by default', async () => {
      const client = createClient()
      await client.ping()
      const fetchParams = getFetchRequestInit()
      expect(fetchParams.keepalive).toBeTruthy()
    })

    it('should be possible to disable it', async () => {
      const client = createClient({ keep_alive: { enabled: false } })
      await client.ping()
      const fetchParams = getFetchRequestInit()
      expect(fetchParams!.keepalive).toBeFalsy()
    })

    it('should be enabled with an explicit setting', async () => {
      const client = createClient({ keep_alive: { enabled: true } })
      await client.ping()
      const fetchParams = getFetchRequestInit()
      expect(fetchParams.keepalive).toBeTruthy()
    })
  })

  describe('Custom fetch', () => {
    it('should use a custom fetch instance', async () => {
      let customFetchWasCalled = false
      const customFetch: typeof fetch = (input, init) => {
        customFetchWasCalled = true
        return globalThis.fetch(input, init)
      }
      const client = createClient({
        fetch: customFetch,
      })
      await client.ping()
      expect(customFetchWasCalled).toBeTruthy()
    })
  })

  function getFetchRequestInit(fetchSpyCalledTimes = 1) {
    expect(fetchSpy).toHaveBeenCalledTimes(fetchSpyCalledTimes)
    const [, requestInit] = fetchSpy.calls.mostRecent().args
    return requestInit!
  }

  const defaultHeaders = {
    Authorization: 'Basic ZGVmYXVsdDo=', // default user with empty password
  }
})
