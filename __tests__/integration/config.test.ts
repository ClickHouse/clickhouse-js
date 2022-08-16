import { type ClickHouseClient } from '../../src'
import { createTestClient } from '../utils'

describe('config', () => {
  beforeAll(function () {
    // FIXME: Jest does not seem to have it
    // if (process.env.browser) {
    //   this.skip();
    // }
  })

  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  it('request_timeout sets request timeout', async () => {
    client = createTestClient({
      request_timeout: 100,
    })

    await expect(
      client.select({
        query: 'SELECT sleep(3)',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringMatching('Timeout error'),
      })
    )
  })
})
