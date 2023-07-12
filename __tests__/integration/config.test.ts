import { createTestClient } from '../utils'
import type { ClickHouseClient } from '@clickhouse/client-common'

describe('config', () => {
  let client: ClickHouseClient

  afterEach(async () => {
    await client.close()
  })

  it('should set request timeout with "request_timeout" setting', async () => {
    client = createTestClient({
      request_timeout: 100,
    })

    await expectAsync(
      client.query({
        query: 'SELECT sleep(3)',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringMatching('Timeout error.'),
      })
    )
  })

  it('should specify the default database name on creation', async () => {
    client = createTestClient({
      database: 'system',
    })
    const result = await client.query({
      query: 'SELECT * FROM numbers LIMIT 2',
      format: 'TabSeparated',
    })
    expect(await result.text()).toEqual('0\n1\n')
  })
})
