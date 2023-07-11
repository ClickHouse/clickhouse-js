import { createTestClient } from "../utils";
import type { ClickHouseClient } from "../../src/client";

/**
 * {@link ClickHouseClient.command} re-introduction is the result of
 * {@link ClickHouseClient.exec} rework due to this report:
 * https://github.com/ClickHouse/clickhouse-js/issues/161
 *
 * This test makes sure that the consequent requests are not blocked by command calls
 */
describe('command', () => {
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
  })
})
