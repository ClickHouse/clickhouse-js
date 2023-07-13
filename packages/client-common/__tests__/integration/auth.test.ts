import { type ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('authentication', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  it('provides authentication error details', async () => {
    client = createTestClient({
      username: 'gibberish',
      password: 'gibberish',
    })

    await expectAsync(
      client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        code: '516',
        type: 'AUTHENTICATION_FAILED',
        message: jasmine.stringMatching('Authentication failed'),
      })
    )
  })
})
