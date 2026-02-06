import { createClient } from '../../src'

describe('[Node.js] errors parsing', () => {
  it('should return an error when URL is unreachable', async () => {
    const client = createClient({
      url: 'http://localhost:1111',
    })
    await expect(
      client.query({
        query: 'SELECT * FROM system.numbers LIMIT 3',
      }),
    ).rejects.toMatchObject({
      code: 'ECONNREFUSED',
    })
  })
})
