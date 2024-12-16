import { EnvKeys, getFromEnv } from '@test/utils/env'
import { createClient } from '../../src'
import type { WebClickHouseClient } from '../../src/client'

/** Cannot use the jsonwebtoken library to generate the token: it is Node.js only.
 *  The access token should be generated externally before running the test,
 *  and set as the CLICKHOUSE_JWT_ACCESS_TOKEN environment variable */
describe('[Web] JWT auth', () => {
  let client: WebClickHouseClient
  let url: string
  let jwt: string

  beforeAll(() => {
    url = `https://${getFromEnv(EnvKeys.host)}:8443`
    jwt = getFromEnv(EnvKeys.jwt_access_token)
  })
  afterEach(async () => {
    await client.close()
  })

  it('should work with client configuration', async () => {
    client = createClient({
      url,
      access_token: jwt,
    })
    const rs = await client.query({
      query: 'SELECT 42 AS result',
      format: 'JSONEachRow',
    })
    expect(await rs.json()).toEqual([{ result: 42 }])
  })

  it('should override the client instance auth', async () => {
    client = createClient({
      url,
      username: 'gibberish',
      password: 'gibberish',
    })
    const rs = await client.query({
      query: 'SELECT 42 AS result',
      format: 'JSONEachRow',
      auth: {
        access_token: jwt,
      },
    })
    expect(await rs.json()).toEqual([{ result: 42 }])
  })
})
