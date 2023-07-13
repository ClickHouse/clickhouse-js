import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '@test/utils'

describe('Node.js ping', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })
  it('does not swallow a client error', async () => {
    client = createTestClient({
      host: 'http://localhost:3333',
    })

    await expectAsync(client.ping()).toBeRejectedWith(
      jasmine.objectContaining({ code: 'ECONNREFUSED' })
    )
  })
})
