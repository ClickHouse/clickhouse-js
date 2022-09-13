import type { ClickHouseClient, InsertParams } from '../../src'
import { SettingsMap } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

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
      .query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        format: 'CSV',
        clickhouse_settings: {
          additional_table_filters: SettingsMap.from({
            'system.numbers': 'number != 3',
          }),
        },
      })
      .then((r) => r.text())
    expect(result).toEqual('0\n1\n2\n4\n5\n')
  })

  // covers both command and insert settings behavior
  // `insert_deduplication_token` will not work without
  // `non_replicated_deduplication_window` merge tree table setting
  // on a single node ClickHouse (but will work on cluster)
  it('should work with insert_deduplication_token', async () => {
    const tableName = `clickhouse_settings_insert__${guid()}`
    await createSimpleTable(client, tableName, {
      non_replicated_deduplication_window: '5',
    })
    const params: InsertParams = {
      table: tableName,
      values: [{ id: '1', name: 'foobar', sku: [1, 2] }],
      format: 'JSONEachRow',
    }
    // See https://clickhouse.com/docs/en/operations/settings/settings/#insert_deduplication_token
    await client.insert({
      // #1
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: 'foo',
      },
    })
    await client.insert({
      // #2
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: 'foo',
      },
    })
    await client.insert({
      // #3
      ...params,
      clickhouse_settings: {
        insert_deduplication_token: 'bar',
      },
    })
    // we will end up with two records since #2
    // is deduplicated due to the same token
    expect(
      await client
        .query({
          query: `SELECT * FROM ${tableName}`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())
    ).toEqual([
      { id: '1', name: 'foobar', sku: [1, 2] },
      { id: '1', name: 'foobar', sku: [1, 2] },
    ])
  })
})
