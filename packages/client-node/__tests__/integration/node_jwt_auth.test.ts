import { TestEnv, whenOnEnv } from '@test/utils'
import { EnvKeys, getFromEnv } from '@test/utils/env'
import { createClient } from '../../src'
import type { NodeClickHouseClient } from '../../src/client'

whenOnEnv(TestEnv.CloudSMT).describe('[Node.js] JWT auth', () => {
  let jwtClient: NodeClickHouseClient
  let url: string
  let jwt: string

  beforeAll(() => {
    url = `https://${getFromEnv(EnvKeys.host)}:8443`
    jwt = getFromEnv(EnvKeys.jwt_access_token)
  })
  afterEach(async () => {
    await jwtClient.close()
  })

  it('should work with client configuration', async () => {
    jwtClient = createClient({
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
    jwtClient = createClient({
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
