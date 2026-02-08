import { describe, it, expect, afterEach } from 'vitest'
import type {
  ClickHouseClient,
  ClickHouseError,
} from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

describe('[Web] ping', () => {
  let client: ClickHouseClient

  afterEach(async () => {
    await client.close()
  })

  it('does not swallow a client error', async () => {
    client = createTestClient({
      url: 'http://localhost:3333',
    })

    const result = await client.ping()
    expect(result.success).toBeFalse()
    // @ts-expect-error
    expect(result.error).toEqual(
      // Chrome = Failed to fetch; FF = NetworkError when attempting to fetch resource
      jasmine.objectContaining({
        message: jasmine.stringContaining('to fetch'),
      }),
    )
  })

  it('checks credentials by default', async () => {
    client = createTestClient({
      username: 'wrong',
    })
    const response = await client.ping({
      select: false, // ignored
    })
    expect(response.success).toBe(false)

    const err = (response as unknown as { error: ClickHouseError }).error
    expect(err.code).toEqual('516')
    expect(err.type).toEqual('AUTHENTICATION_FAILED')
    expect(err.message).toEqual(
      jasmine.stringContaining('Authentication failed'),
    )
  })
})
