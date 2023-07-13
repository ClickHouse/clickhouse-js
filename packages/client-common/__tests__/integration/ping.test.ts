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
    expect(response).toBe(true)
  })
})
