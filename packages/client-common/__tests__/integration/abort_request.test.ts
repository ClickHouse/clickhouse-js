import type { ClickHouseClient, ResponseJSON } from '@clickhouse/client-common'
import { createTestClient, guid } from '../utils'

describe('abort request', () => {
  let client: ClickHouseClient

  beforeEach(() => {
    client = createTestClient()
  })

  afterEach(async () => {
    await client.close()
  })

  describe('select', () => {
    it('cancels a select query before it is sent', async () => {
      const controller = new AbortController()
      const selectPromise = client.query({
        query: 'SELECT sleep(3)',
        format: 'CSV',
        abort_signal: controller.signal,
      })
      controller.abort()

      await expectAsync(selectPromise).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringMatching('The user aborted a request'),
        })
      )
    })

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
        })
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
        })
      )
    })

    // FIXME: it does not work with ClickHouse Cloud.
    //  Active queries never contain the long-running query unlike local setup.
    xit('ClickHouse server must cancel query on abort', async () => {
      const controller = new AbortController()

      const longRunningQuery = `SELECT sleep(3), '${guid()}'`
      console.log(`Long running query: ${longRunningQuery}`)
      void client.query({
        query: longRunningQuery,
        abort_signal: controller.signal,
        format: 'JSONCompactEachRow',
      })

      await assertActiveQueries(client, (queries) => {
        console.log(`Active queries: ${JSON.stringify(queries, null, 2)}`)
        return queries.some((q) => q.query.includes(longRunningQuery))
      })

      controller.abort()

      await assertActiveQueries(client, (queries) =>
        queries.every((q) => !q.query.includes(longRunningQuery))
      )
    })

    it('should cancel of the select queries while keeping the others', async () => {
      type Res = Array<{ foo: number }>

      const controller = new AbortController()
      const results: number[] = []

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
            .then((r) => r.json<Res>())
            .then((r) => results.push(r[0].foo))
          // this way, the cancelled request will not cancel the others
          if (shouldAbort) {
            return requestPromise.catch(() => {
              // ignored
            })
          }
          return requestPromise
        })
      )

      controller.abort()
      await selectPromises

      expect(results.sort((a, b) => a - b)).toEqual([0, 1, 2, 4])
    })
  })
})

async function assertActiveQueries(
  client: ClickHouseClient,
  assertQueries: (queries: Array<{ query: string }>) => boolean
) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rs = await client.query({
      query: 'SELECT query FROM system.processes',
      format: 'JSON',
    })

    const queries = await rs.json<ResponseJSON<{ query: string }>>()

    if (assertQueries(queries.data)) {
      break
    }

    await new Promise((res) => setTimeout(res, 100))
  }
}
