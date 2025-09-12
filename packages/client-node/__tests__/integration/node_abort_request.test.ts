import type { ClickHouseClient, Row } from '@clickhouse/client-common'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { jsonValues } from '@test/fixtures/test_data'
import { createTestClient, guid } from '@test/utils'
import type Stream from 'stream'
import { makeObjectStream } from '../utils/stream'

describe('[Node.js] abort request', () => {
  let client: ClickHouseClient<Stream.Readable>

  beforeEach(() => {
    client = createTestClient<Stream.Readable>()
  })

  afterEach(async () => {
    await client.close()
  })

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
        // this happens even before we instantiate the request and its listeners, so that is just a plain AbortError
        name: 'AbortError',
      }),
    )
  })

  it('cancels a select query while reading response', async () => {
    const controller = new AbortController()
    const selectPromise = client
      .query({
        query: 'SELECT * from system.numbers',
        format: 'JSONCompactEachRow',
        abort_signal: controller.signal,
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
    await expectAsync(selectPromise).toBeRejectedWithError()
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
    await expectAsync(selectPromise).toBeRejectedWithError()
  })

  describe('insert', () => {
    let tableName: string
    beforeEach(async () => {
      tableName = `abort_request_insert_test_${guid()}`
      await createSimpleTable(client, tableName)
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
            abort_signal: shouldAbort(i) ? controller.signal : undefined,
          })
          if (shouldAbort(i)) {
            return insertPromise.catch(() => {
              // ignored
            })
          }
          return insertPromise
        }),
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

    it('cancels an insert query before it is sent', async () => {
      const controller = new AbortController()
      const stream = makeObjectStream()
      const insertPromise = client.insert({
        table: tableName,
        values: stream,
        abort_signal: controller.signal,
      })
      controller.abort()

      await expectAsync(insertPromise).toBeRejectedWith(
        jasmine.objectContaining({
          // this happens even before we instantiate the request and its listeners, so that is just a plain AbortError
          name: 'AbortError',
        }),
      )
    })

    it('cancels an insert query before it is sent by closing a stream', async () => {
      const stream = makeObjectStream()
      stream.push(null)

      expect(
        await client.insert({
          table: tableName,
          values: stream,
        }),
      ).toEqual(
        jasmine.objectContaining({
          query_id: jasmine.any(String),
        }),
      )
    })

    it('cancels an insert query after it is sent', async () => {
      const controller = new AbortController()
      const stream = makeObjectStream()
      const insertPromise = client.insert({
        table: tableName,
        values: stream,
        abort_signal: controller.signal,
      })

      setTimeout(() => {
        controller.abort()
      }, 50)

      await expectAsync(insertPromise).toBeRejectedWith(
        jasmine.objectContaining({
          message: jasmine.stringMatching('The user aborted a request'),
        }),
      )
    })
  })
})
