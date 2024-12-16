import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, TestEnv, whenOnEnv } from '@test/utils'
import { EnvKeys, getFromEnv } from '@test/utils/env'
import { makeJWT } from '../utils/jwt'

whenOnEnv(TestEnv.CloudSMT).describe('[Node.js] JWT auth', () => {
  let jwtClient: ClickHouseClient
  let url: string
  let jwt: string

  beforeAll(() => {
    url = `https://${getFromEnv(EnvKeys.host)}:8443`
    jwt = makeJWT()
  })
  afterEach(async () => {
    await jwtClient.close()
  })

  it('should work with client configuration', async () => {
    jwtClient = createTestClient({
      url,
      access_token: jwt,
    })
    const rs = await jwtClient.query({
      query: 'SELECT 42 AS result',
      format: 'JSONEachRow',
    })
    expect(await rs.json()).toEqual([{ result: 42 }])
  })

  it('should override the client instance auth', async () => {
    jwtClient = createTestClient({
      url,
      username: 'gibberish',
      password: 'gibberish',
    })
    const rs = await jwtClient.query({
      query: 'SELECT 42 AS result',
      format: 'JSONEachRow',
      auth: {
        access_token: jwt,
      },
    })
    expect(await rs.json()).toEqual([{ result: 42 }])
  })
})
