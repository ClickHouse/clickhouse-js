import { type ClickHouseClient } from '../../src'
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

  it('does not swallow a client error', async () => {
    client = createTestClient({
      host: 'http://localhost:3333',
    })

    await expect(client.ping()).rejects.toEqual(
      expect.objectContaining({ code: 'ECONNREFUSED' })
    )
  })
})
