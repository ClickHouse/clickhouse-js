import { type ClickHouseClient } from '../../src'
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

    await expect(
      client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        code: '516',
        type: 'AUTHENTICATION_FAILED',
        message: expect.stringMatching('Authentication failed'),
      })
    )
  })
})
