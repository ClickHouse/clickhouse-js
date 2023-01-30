import { type ClickHouseClient } from '../../src'
import { createTestClient, retryOnFailure } from '../utils'
import { itSkipCloud } from '../utils/it'

describe('query_log', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    if (client) {
      await client.close()
    }
  })

  // this test is very flaky in the Cloud environment
  // likely due flushing the query_log not too often
  // it's better to execute only with the local single node or cluster
  itSkipCloud('can use query_id to fetch query_log table', async () => {
    client = createTestClient()
    const query = 'SELECT * FROM system.numbers LIMIT 144'
    const { query_id } = await client.query({
      query,
      format: 'JSON',
    })

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
        const formattedQuery =
          'SELECT * FROM system.numbers LIMIT 144 \nFORMAT JSON'
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
        maxAttempts: 100,
        waitBetweenAttemptsMs: 100,
      }
    )
  })
})
