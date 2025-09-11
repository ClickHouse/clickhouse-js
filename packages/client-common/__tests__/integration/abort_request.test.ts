import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient, guid, sleep } from '../utils'

describe('abort request', () => {
  let client: ClickHouseClient

  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  describe('select', () => {
    it('cancels a select query after it is sent', async () => {
      const controller = new AbortController()
      const selectPromise = client.query({
        query: 'SELECT sleep(3)',
        format: 'CSV',
        abort_signal: controller.signal,
      })

      await new Promise((resolve) => {
        setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, 50)
      })

      await expectAsync(selectPromise).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringMatching('The user aborted a request'),
        }),
      )
    })

    it('should not throw an error when aborted the second time', async () => {
      const controller = new AbortController()
      const selectPromise = client.query({
        query: 'SELECT sleep(3)',
        format: 'CSV',
        abort_signal: controller.signal,
      })

      await new Promise((resolve) => {
        setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, 50)
      })

      controller.abort('foo bar') // no-op, does not throw here

      await expectAsync(selectPromise).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringMatching('The user aborted a request'),
        }),
      )
    })

    // FIXME: It does not work with ClickHouse Cloud.
    //  Active queries never contain the long-running query unlike local setup.
    //  To be revisited in https://github.com/ClickHouse/clickhouse-js/issues/177
    xit('ClickHouse server must cancel query on abort', async () => {
      const controller = new AbortController()

      const longRunningQuery = `SELECT sleep(3), '${guid()}'`
      console.log(`Long running query: ${longRunningQuery}`)
      void client
        .query({
          query: longRunningQuery,
          abort_signal: controller.signal,
          format: 'JSONCompactEachRow',
        })
        .catch(() => {
          // ignore aborted query exception
        })

      // Long-running query should be there
      await assertActiveQueries(client, (queries) => {
        console.log(`Active queries: ${JSON.stringify(queries, null, 2)}`)
        return queries.some((q) => q.query.includes(longRunningQuery))
      })

      controller.abort()

      // Long-running query should be cancelled on the server
      await assertActiveQueries(client, (queries) =>
        queries.every((q) => {
          console.log(`${q.query} VS ${longRunningQuery}`)
          return !q.query.includes(longRunningQuery)
        }),
      )
    })

    it('should cancel of the select queries while keeping the others', async () => {
      const controller = new AbortController()
      const results: Array<number> = []

      const selectPromises = Promise.all(
        [...Array(5)].map((_, i) => {
          const shouldAbort = i === 3
          const requestPromise = client
            .query({
              query: `SELECT sleep(0.5), ${i} AS foo`,
              format: 'JSONEachRow',
              abort_signal:
                // we will cancel the request that should've yielded '3'
                shouldAbort ? controller.signal : undefined,
            })
            .then((r) => r.json<{ foo: number }>())
            .then((r) => results.push(r[0].foo))
          // this way, the cancelled request will not cancel the others
          if (shouldAbort) {
            return requestPromise.catch(() => {
              // ignored
            })
          }
          return requestPromise
        }),
      )

      controller.abort()
      await selectPromises

      expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 4])
    })
  })
})

async function assertActiveQueries(
  client: ClickHouseClient,
  assertQueries: (queries: Array<{ query: string }>) => boolean,
) {
  let isRunning = true
  while (isRunning) {
    const rs = await client.query({
      query: 'SELECT query FROM system.processes',
      format: 'JSON',
    })
    const queries = await rs.json<{ query: string }>()
    if (assertQueries(queries.data)) {
      isRunning = false
    } else {
      await sleep(100)
    }
  }
}
