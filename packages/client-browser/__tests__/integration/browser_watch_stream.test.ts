import type { Row } from '@clickhouse/client-common'
import { type ClickHouseClient } from '@clickhouse/client-common'
import {
  createTable,
  createTestClient,
  guid,
  TestEnv,
  whenOnEnv,
} from '@test/utils'

describe('Browser WATCH stream', () => {
  let client: ClickHouseClient<ReadableStream>
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
    viewName = `browser_watch_stream_test_${guid()}`
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

  /**
   * "Does not work with replicated or distributed tables where inserts are performed on different nodes"
   * @see https://clickhouse.com/docs/en/sql-reference/statements/create/view#live-view-experimental
   */
  whenOnEnv(TestEnv.LocalSingleNode).it(
    'should eventually get several events using WATCH',
    async () => {
      const resultSet = await client.query({
        query: `WATCH ${viewName} EVENTS`,
        format: 'JSONEachRow',
      })
      const stream = resultSet.stream()
      const data = new Array<{ version: string }>()
      let i = 0
      const reader = stream.getReader()
      while (i < 2) {
        const result: ReadableStreamReadResult<Row[]> = await reader.read()
        result.value!.forEach((row) => {
          data.push(row.json())
        })
        i++
      }
      await reader.releaseLock()
      await stream.cancel()
      expect(data).toEqual([{ version: '1' }, { version: '2' }])
    }
  )
})
