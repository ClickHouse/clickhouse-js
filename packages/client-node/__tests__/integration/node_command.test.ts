import type { ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createTestClient } from '../utils/client.node'

/**
 * {@link ClickHouseClient.command} re-introduction is the result of
 * {@link ClickHouseClient.exec} rework due to this report:
 * https://github.com/ClickHouse/clickhouse-js/issues/161
 *
 * This test makes sure that the consequent requests are not blocked by command calls
 */
describe('[Node.js] command', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient({
      max_open_connections: 1,
      request_timeout: 10000,
    })
  })
  afterEach(async () => {
    await client.close()
  })

  it('should destroy the response stream immediately', async () => {
    const timeout = setTimeout(() => {
      throw new Error('Timeout was triggered')
    }, 3000).unref()
    function command() {
      return client.command({
        query: `SELECT 1 FORMAT CSV`,
      })
    }
    await command()
    await command() // if previous call holds the socket, the test will time out
    clearTimeout(timeout)
    expect(1).toBe(1) // Vitest needs at least 1 assertion
  })

  describe('ignore error response', () => {
    it('should throw an error by default when ignore_error_response is not set', async () => {
      await expect(
        client.command({
          query: 'invalid',
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Syntax error'),
      })
    })

    it('should throw an error when ignore_error_response is false', async () => {
      await expect(
        client.command({
          query: 'invalid',
          ignore_error_response: false,
        }),
      ).rejects.toMatchObject({
        message: expect.stringContaining('Syntax error'),
      })
    })

    it('should not throw an error when ignore_error_response is true', async () => {
      const result = await client.command({
        query: 'invalid',
        ignore_error_response: true,
      })
      // command doesn't return a stream, just summary info
      expect(result.query_id).toBeDefined()
    })
  })
})
