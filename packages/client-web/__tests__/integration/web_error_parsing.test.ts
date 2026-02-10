import { describe, it, expect } from 'vitest'
import { createClient } from '../../src'

describe('[Web] errors parsing', () => {
  it('should return an error when URL is unreachable', async () => {
    const client = createClient({
      url: 'http://localhost:1111',
    })
    await expect(
      client.query({
        query: 'SELECT * FROM system.numbers LIMIT 3',
      }),
    ).rejects.toMatchObject(
      // Chrome = Failed to fetch; FF = NetworkError when attempting to fetch resource
      expect.objectContaining({
        message: expect.stringContaining('to fetch'),
      }),
    )
  })
})
