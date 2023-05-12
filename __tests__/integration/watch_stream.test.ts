import type { Row } from '../../src'
import { type ClickHouseClient } from '../../src'
import { createTable, createTestClient, guid, retryOnFailure } from '../utils'

describe('watch stream', () => {
  let client: ClickHouseClient
  let viewName: string

  beforeEach(async () => {
    client = await createTestClient({
      compression: {
        response: false, // WATCH won't work with response compression
      },
      clickhouse_settings: {
        allow_experimental_live_view: 1,
      },
    })
    viewName = `watch_stream_test_${guid()}`
    await createTable(
      client,
      () => `CREATE LIVE VIEW ${viewName} WITH REFRESH 1 AS SELECT now()`
    )
  })

  afterEach(async () => {
    await client.exec({
      query: `DROP VIEW ${viewName}`,
      clickhouse_settings: { wait_end_of_query: 1 },
    })
    await client.close()
  })

  it('should eventually get several events using WATCH', async () => {
    const resultSet = await client.query({
      query: `WATCH ${viewName} EVENTS`,
      format: 'JSONEachRow',
    })
    const stream = resultSet.stream()
    const data = new Array<{ version: string }>()
    stream.on('data', (rows: Row[]) => {
      rows.forEach((row) => {
        data.push(row.json())
      })
    })
    await retryOnFailure(
      async () => {
        expect(data).toEqual([{ version: '1' }, { version: '2' }])
      },
      {
        maxAttempts: 5,
        waitBetweenAttemptsMs: 1000,
      }
    )
  })
})
