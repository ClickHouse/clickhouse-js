import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, TestEnv, whenOnEnv } from '../utils'

describe('ping', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  // FIXME: weird CORS issues with ping only when on localhost
  whenOnEnv(TestEnv.Cloud).it('makes a ping request', async () => {
    client = createTestClient()
    const response = await client.ping()
    // @ts-expect-error
    console.error(response.error)
    expect(response.success).toBe(true)
  })
})
