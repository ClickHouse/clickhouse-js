import { type ClickHouseClient } from '@clickhouse/client-common'
import { it, beforeEach, afterEach, expect } from 'vitest'
import { createSimpleTable } from '@test/fixtures/simple_table'
import { assertJsonValues, jsonValues } from '@test/fixtures/test_data'
import { createTestClient } from '@test/utils/client'
import { guid } from '@test/utils/guid'
import Stream from 'stream'
import { makeObjectStream } from '../utils/stream'

let client: ClickHouseClient
let tableName: string

beforeEach(async () => {
  client = createTestClient()
  tableName = `insert_stream_json_${guid()}`
  await createSimpleTable(client, tableName)
})
afterEach(async () => {
  await client.close()
})

it('does not throw if stream closes prematurely', async () => {
  const stream = new Stream.Readable({
    objectMode: true,
    read() {
      this.push(null) // close stream
    },
  })

  await expect(
    client.insert({
      table: tableName,
      values: stream,
    }),
  ).resolves.toBeDefined()
})

it('waits for stream of values to be closed', async () => {
  let closed = false
  const stream = new Stream.Readable({
    objectMode: true,
    read() {
      setTimeout(() => {
        this.push([42, 'hello', [0, 1]])
        this.push([43, 'world', [3, 4]])
        this.push(null)
        closed = true
      }, 100)
    },
  })

  expect(closed).toBe(false)
  await client.insert({
    table: tableName,
    values: stream,
  })
  expect(closed).toBe(true)
})

it('can insert multiple streams at once', async () => {
  const streams: Stream.Readable[] = Array(jsonValues.length)
  const insertStreamPromises = Promise.all(
    jsonValues.map((value, i) => {
      const stream = makeObjectStream()
      streams[i] = stream
      stream.push(value)
      return client.insert({
        values: stream,
        format: 'JSONEachRow',
        table: tableName,
      })
    }),
  )
  setTimeout(() => {
    streams.forEach((stream) => stream.push(null))
  }, 100)
  await insertStreamPromises
  await assertJsonValues(client, tableName)
})

it('should throw in case of an invalid format of data', async () => {
  const stream = makeObjectStream()
  stream.push({ id: 'baz', name: 'foo', sku: '[0,1]' })
  stream.push(null)
  await expect(
    client.insert({
      table: tableName,
      values: stream,
      format: 'JSONEachRow',
    }),
  ).rejects.toMatchObject({
    message: expect.stringContaining('Cannot parse input'),
  })
})
