import { describe, it, expect, beforeEach, vi } from 'vitest'
import { TestEnv, isOnEnv } from '@test/utils/test_env'
import http from 'http'
import Http from 'http'
import { createClient } from '../../src'

/** HTTPS agent tests are in tls.test.ts as it requires a secure connection. */
describe.skipIf(!isOnEnv(TestEnv.LocalSingleNode, TestEnv.LocalCluster))(
  '[Node.js] custom HTTP agent',
  () => {
    let httpRequestStub: ReturnType<typeof vi.spyOn>
    beforeEach(() => {
      httpRequestStub = vi.spyOn(Http, 'request')
    })

    // disabled with Cloud as it uses a simple HTTP agent
    // whenOnEnv(TestEnv.LocalSingleNode, TestEnv.LocalCluster).it(
    it('should use provided http agent instead of the default one', async () => {
      const agent = new http.Agent({
        maxFreeSockets: 5,
      })
      const client = createClient({
        http_agent: agent,
      })
      const rs = await client.query({
        query: 'SELECT 42 AS result',
        format: 'JSONEachRow',
      })
      expect(await rs.json()).toEqual([{ result: 42 }])
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const callArgs =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1]
      expect(callArgs[1].agent).toBe(agent)
    })
  },
)
