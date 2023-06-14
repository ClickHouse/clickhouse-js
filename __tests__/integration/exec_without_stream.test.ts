import { createTestClient } from '../utils'
import type { ClickHouseClient } from '../../src/client'

/**
 * See https://github.com/ClickHouse/clickhouse-js/issues/161 for more details
 *
 * This test makes sure that the consequent requests are not blocked by exec calls
 * that do not include the response stream in the return type
 */
describe('exec without streaming', () => {
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

  it('should destroy the response stream immediately (parameter is omitted)', async () => {
    const timeout = setTimeout(() => {
      throw new Error('Timeout was triggered')
    }, 3000).unref()
    function exec() {
      return client.exec({
        query: `SELECT 1 FORMAT CSV`,
      })
    }
    await exec()
    await exec()
    clearTimeout(timeout)
  })

  it('should destroy the response stream immediately (explicit false)', async () => {
    const timeout = setTimeout(() => {
      throw new Error('Timeout was triggered')
    }, 3000).unref()
    function exec() {
      return client.exec({
        query: `SELECT 1 FORMAT CSV`,
        returnResponseStream: false,
      })
    }
    await exec()
    await exec()
    clearTimeout(timeout)
  })
})
