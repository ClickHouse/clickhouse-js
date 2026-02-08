import { describe, it, expect, afterEach } from 'vitest'
import type {
  ClickHouseClient,
  ClickHouseError,
} from '@clickhouse/client-common'
import { createTestClient } from '../utils/client.node'

describe('[Node.js] ping', () => {
  let client: ClickHouseClient

  afterEach(async () => {
    await client.close()
  })

  it('does not swallow a client error', async () => {
    client = createTestClient({
      url: 'http://localhost:3333',
    })

    const result = await client.ping()
    expect(result.success).toBeFalsy()
    // @ts-expect-error
    expect(result.error).toEqual(
      expect.objectContaining({
        code: 'ECONNREFUSED',
      }),
    )
  })

  it('ignores credentials by default', async () => {
    client = createTestClient({
      username: 'wrong',
    })
    const response = await client.ping()
    expect(response.success).toBe(true)
  })

  it('checks credentials when select query mode is enabled', async () => {
    client = createTestClient({
      username: 'wrong',
    })
    const response = await client.ping({
      select: true,
    })
    expect(response.success).toBe(false)

    const err = (response as unknown as { error: ClickHouseError }).error
    expect(err.code).toEqual('516')
    expect(err.type).toEqual('AUTHENTICATION_FAILED')
    expect(err.message).toEqual(
      expect.stringContaining('Authentication failed'),
    )
  })
})
