import { type ClickHouseClient } from '../../src'
import { createTestClient } from '../utils'

describe('response compression', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })

  it('accepts a compressed response', async () => {
    client = createTestClient({
      compression: {
        response: true,
      },
    })

    const rows = await client.query({
      query: `
        SELECT number
        FROM system.numbers
        LIMIT 20000
      `,
      format: 'JSONEachRow',
    })

    const response = await rows.json<{ number: string }[]>()
    const last = response[response.length - 1]
    expect(last.number).toBe('19999')
  })
})
