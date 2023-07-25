import { createClient } from '../../src'

describe('[Web] errors parsing', () => {
  it('should return an error when URL is unreachable', async () => {
    const client = createClient({
      host: 'http://localhost:1111',
    })
    await expectAsync(
      client.query({
        query: 'SELECT * FROM system.numbers LIMIT 3',
      })
    ).toBeRejectedWith(
      // Chrome = Failed to fetch; FF = NetworkError when attempting to fetch resource
      jasmine.objectContaining({
        message: jasmine.stringContaining('to fetch'),
      })
    )
  })
})
