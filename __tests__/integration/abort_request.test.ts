import { AbortController } from 'node-abort-controller'
import type { Row } from '../../src'
import { type ClickHouseClient, type ResponseJSON } from '../../src'
import { createTestClient, guid, makeObjectStream } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'
import type Stream from 'stream'
import { jsonValues } from './fixtures/test_data'

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
        abort_signal: controller.signal as AbortSignal,
      })
      controller.abort()

      await expect(selectPromise).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringMatching('The request was aborted'),
        })
      )
    })

    it('cancels a select query after it is sent', async () => {
      const controller = new AbortController()
      const selectPromise = client.query({
        query: 'SELECT sleep(3)',
        format: 'CSV',
        abort_signal: controller.signal as AbortSignal,
      })

      setTimeout(() => {
        controller.abort()
      }, 50)

      await expect(selectPromise).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringMatching('The request was aborted'),
        })
      )
    })

    it('cancels a select query while reading response', async () => {
      const controller = new AbortController()
      const selectPromise = client
        .query({
          query: 'SELECT * from system.numbers',
          format: 'JSONCompactEachRow',
          abort_signal: controller.signal as AbortSignal,
        })
        .then(async (rows) => {
          const stream = rows.stream()
          for await (const chunk of stream) {
            const [[number]] = chunk.json()
            // abort when reach number 3
            if (number === '3') {
              controller.abort()
            }
          }
        })

      // There is no assertion against an error message.
      // A race condition on events might lead to
      // Request Aborted or ERR_STREAM_PREMATURE_CLOSE errors.
      await expect(selectPromise).rejects.toThrowError()
    })

    it('cancels a select query while reading response by closing response stream', async () => {
      const selectPromise = client
        .query({
          query: 'SELECT * from system.numbers',
          format: 'JSONCompactEachRow',
        })
        .then(async function (rows) {
          const stream = rows.stream()
          for await (const rows of stream) {
            rows.forEach((row: Row) => {
              const [[number]] = row.json<[[string]]>()
              // abort when reach number 3
              if (number === '3') {
                stream.destroy()
              }
            })
          }
        })
      // There was a breaking change in Node.js 18.x+ behavior
      if (
        process.version.startsWith('v18') ||
        process.version.startsWith('v19')
      ) {
        await expect(selectPromise).rejects.toMatchObject({
          message: 'Premature close',
        })
      } else {
        expect(await selectPromise).toEqual(undefined)
      }
    })

    // FIXME: it does not work with ClickHouse Cloud.
    //  Active queries never contain the long-running query unlike local setup.
    it.skip('ClickHouse server must cancel query on abort', async () => {
      const controller = new AbortController()

      const longRunningQuery = `SELECT sleep(3), '${guid()}'`
      console.log(`Long running query: ${longRunningQuery}`)
      void client.query({
        query: longRunningQuery,
        abort_signal: controller.signal as AbortSignal,
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
                shouldAbort ? (controller.signal as AbortSignal) : undefined,
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

  describe('insert', () => {
    let tableName: string
    beforeEach(async () => {
      tableName = `abort_request_insert_test_${guid()}`
      await createSimpleTable(client, tableName)
    })

    it('cancels an insert query before it is sent', async () => {
      const controller = new AbortController()
      const stream = makeObjectStream()
      const insertPromise = client.insert({
        table: tableName,
        values: stream,
        abort_signal: controller.signal as AbortSignal,
      })
      controller.abort()

      await expect(insertPromise).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringMatching('The request was aborted'),
        })
      )
    })

    it('cancels an insert query before it is sent by closing a stream', async () => {
      const stream = makeObjectStream()
      stream.push(null)

      expect(
        await client.insert({
          table: tableName,
          values: stream,
        })
      ).toEqual(
        expect.objectContaining({
          query_id: expect.any(String),
        })
      )
    })

    it('cancels an insert query after it is sent', async () => {
      const controller = new AbortController()
      const stream = makeObjectStream()
      const insertPromise = client.insert({
        table: tableName,
        values: stream,
        abort_signal: controller.signal as AbortSignal,
      })

      setTimeout(() => {
        controller.abort()
      }, 50)

      await expect(insertPromise).rejects.toEqual(
        expect.objectContaining({
          message: expect.stringMatching('The request was aborted'),
        })
      )
    })

    it('should cancel one insert while keeping the others', async () => {
      function shouldAbort(i: number) {
        // we will cancel the request
        // that should've inserted a value at index 3
        return i === 3
      }

      const controller = new AbortController()
      const streams: Stream.Readable[] = Array(jsonValues.length)
      const insertStreamPromises = Promise.all(
        jsonValues.map((value, i) => {
          const stream = makeObjectStream()
          streams[i] = stream
          stream.push(value)
          const insertPromise = client.insert({
            values: stream,
            format: 'JSONEachRow',
            table: tableName,
            abort_signal: shouldAbort(i)
              ? (controller.signal as AbortSignal)
              : undefined,
          })
          if (shouldAbort(i)) {
            return insertPromise.catch(() => {
              // ignored
            })
          }
          return insertPromise
        })
      )

      setTimeout(() => {
        streams.forEach((stream, i) => {
          if (shouldAbort(i)) {
            controller.abort()
          }
          stream.push(null)
        })
      }, 100)

      await insertStreamPromises

      const result = await client
        .query({
          query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
          format: 'JSONEachRow',
        })
        .then((r) => r.json())

      expect(result).toEqual([
        jsonValues[0],
        jsonValues[1],
        jsonValues[2],
        jsonValues[4],
      ])
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
