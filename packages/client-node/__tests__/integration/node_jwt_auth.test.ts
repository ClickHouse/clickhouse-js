import { describe, it, expect } from 'vitest'
import { TestEnv, isOnEnv } from '@test/utils/test_env'
import { EnvKeys, getFromEnv, maybeGetFromEnv } from '@test/utils/env'
import { createClient } from '../../src'
import type { NodeClickHouseClient } from '../../src/client'

describe.skipIf(!isOnEnv(TestEnv.Cloud))('[Node.js] JWT auth', () => {
  let jwtClient: NodeClickHouseClient
  let url: string
  let jwt: string | undefined

  beforeAll(() => {
    url = `https://${getFromEnv(EnvKeys.host)}:8443`
    jwt = maybeGetFromEnv(EnvKeys.jwt_access_token)
  })
  afterEach(async () => {
    await jwtClient?.close()
  })

  it('should work with client configuration', async ({ skip }) => {
    if (!jwt) {
      skip(`Environment variable ${EnvKeys.jwt_access_token} is not set`)
    }

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

  it('should override the client instance auth', async ({ skip }) => {
    if (!jwt) {
      skip(`Environment variable ${EnvKeys.jwt_access_token} is not set`)
    }

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
