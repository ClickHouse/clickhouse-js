import { ClickHouseClient } from '../../src'
import { createTestClient } from '../utils'

// TODO: cover at least all enum settings
describe('ClickHouse settings', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  it('should work with additional_table_filters map', async () => {
    const result = await client
      .select({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        format: 'CSV',
        clickhouse_settings: {
          additional_table_filters: {
            'system.numbers': 'number != 3',
          },
        },
      })
      .then((r) => r.text())
    expect(result).toEqual('0\n1\n2\n4\n5\n')
  })
})
