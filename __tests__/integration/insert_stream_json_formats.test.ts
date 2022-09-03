import { type ClickHouseClient } from '../../src'
import Stream from 'stream'
import { createTestClient, guid, makeObjectStream } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'
import { assertJsonValues, jsonValues } from './fixtures/test_data'

describe('insert stream (JSON formats)', () => {
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

  it('can insert values as a Stream', async () => {
    const stream = makeObjectStream()
    jsonValues.forEach((value) => stream.push(value))
    setTimeout(() => stream.push(null), 100)
    await client.insert({
      table: tableName,
      values: stream,
      format: 'JSONEachRow',
    })
    await assertJsonValues(client, tableName)
  })

  it('does not throw if stream closes prematurely', async () => {
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        this.push(null) // close stream
      },
    })

    await client.insert({
      table: tableName,
      values: stream,
    })
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
      })
    )
    setTimeout(() => {
      streams.forEach((stream) => stream.push(null))
    }, 100)
    await insertStreamPromises
    await assertJsonValues(client, tableName)
  })
})
