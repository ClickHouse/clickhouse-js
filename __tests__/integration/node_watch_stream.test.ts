import type { Row } from 'client-common/src'
import { type ClickHouseClient } from 'client-common/src'
import {
  createTable,
  createTestClient,
  guid,
  retryOnFailure,
  TestEnv,
  whenOnEnv,
} from '../utils'
import type Stream from 'stream'

describe('Node.js WATCH stream', () => {
  let client: ClickHouseClient<Stream.Readable>
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
      stream.destroy()
    }
  )
})
