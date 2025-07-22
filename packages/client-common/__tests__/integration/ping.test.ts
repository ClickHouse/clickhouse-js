import { type ClickHouseError } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('ping', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  it('makes a ping request', async () => {
    client = createTestClient()
    const response = await client.ping()
    expect(response.success).toBe(true)
  })

  it('requires valid credentials', async () => {
    client = createTestClient({
      username: 'wrong',
    })
    const response = await client.ping()
    expect(response.success).toBe(false)

    const err = (response as unknown as { error: ClickHouseError }).error
    expect(err.code).toEqual('516')
    expect(err.type).toEqual('AUTHENTICATION_FAILED')
    expect(err.message).toEqual(
      jasmine.stringContaining('Authentication failed'),
    )
  })
})
