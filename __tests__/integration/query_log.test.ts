import { type ClickHouseClient } from '../../src'
import { createTestClient, guid, retryOnFailure } from '../utils'
import { itSkipCloud } from '../utils/it'
import { createSimpleTable } from './fixtures/simple_table'

// these tests are very flaky in the Cloud environment
// likely due flushing the query_log not too often
// it's better to execute only with the local single node or cluster
describe('query_log', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    if (client) {
      await client.close()
    }
  })

  itSkipCloud(
    'can use query_id to fetch query_log table with select',
    async () => {
      client = createTestClient()
      const query = 'SELECT * FROM system.numbers LIMIT 144'
      const { query_id } = await client.query({
        query,
        format: 'JSON',
      })
      const formattedQuery =
        'SELECT * FROM system.numbers LIMIT 144 \nFORMAT JSON'
      await assertQueryLog({ formattedQuery, query_id })
    }
  )

  itSkipCloud(
    'can use query_id to fetch query_log table with exec',
    async () => {
      client = createTestClient()
      const table = `clickhouse_query_id_exec_test__${guid()}`
      const query = `CREATE TABLE ${table} (id String) ENGINE MergeTree() ORDER BY (id)`
      const { query_id } = await client.exec({
        query,
      })
      await assertQueryLog({ formattedQuery: query, query_id })
    }
  )

  itSkipCloud(
    'can use query_id to fetch query_log table with insert',
    async () => {
      client = createTestClient()
      const table = `clickhouse_query_id_insert_test__${guid()}`
      await createSimpleTable(client, table)
      const { query_id } = await client.insert({
        table,
        values: {
          a: { id: '42', name: 'hello', sku: [0, 1] },
        },
        format: 'JSONObjectEachRow',
      })
      const formattedQuery = `INSERT INTO ${table} FORMAT JSONObjectEachRow\n`
      await assertQueryLog({ formattedQuery, query_id })
    }
  )

  async function assertQueryLog({
    formattedQuery,
    query_id,
  }: {
    formattedQuery: string
    query_id: string
  }) {
    // query_log is flushed every ~1000 milliseconds
    // so this might fail a couple of times
    await retryOnFailure(
      async () => {
        const logResultSet = await client.query({
          query: `
        SELECT * FROM system.query_log
        WHERE query_id = {query_id: String}
      `,
          query_params: {
            query_id,
          },
          format: 'JSONEachRow',
        })
        expect(await logResultSet.json()).toEqual([
          expect.objectContaining({
            type: 'QueryStart',
            query: formattedQuery,
            initial_query_id: query_id,
            query_duration_ms: expect.any(String),
            read_rows: expect.any(String),
            read_bytes: expect.any(String),
          }),
          expect.objectContaining({
            type: 'QueryFinish',
            query: formattedQuery,
            initial_query_id: query_id,
            query_duration_ms: expect.any(String),
            read_rows: expect.any(String),
            read_bytes: expect.any(String),
          }),
        ])
      },
      {
        maxAttempts: 30,
        waitBetweenAttemptsMs: 100,
      }
    )
  }
})
