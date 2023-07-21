import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

xdescribe('ping', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  it('makes a ping request', async () => {
    client = createTestClient()
    const response = await client.ping()
    // @ts-expect-error
    console.error(response.error)
    expect(response.success).toBe(true)
  })
})
