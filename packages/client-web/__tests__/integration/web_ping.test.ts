import type { ClickHouseClient } from '@clickhouse/client-common'
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
})
