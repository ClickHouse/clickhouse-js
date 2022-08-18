import type { ResponseJSON } from '../../src'
import { type ClickHouseClient } from '../../src'
import Stream from 'stream'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'

describe('insert stream', () => {
  beforeAll(function () {
    // FIXME: Jest does not seem to have it
    // if (process.env.browser) {
    //   this.skip();
    // }
  })

  let client: ClickHouseClient
  let tableName: string
  beforeEach(async () => {
    client = createTestClient()
    tableName = `insert_stream_test_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('can insert values as a Stream', async () => {
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        /* stub */
      },
    })

    stream.push([42, 'hello', [0, 1]])
    stream.push([43, 'world', [3, 4]])
    setTimeout(() => stream.push(null), 100)
    await client.insert({
      table: tableName,
      values: stream,
    })

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    })

    const result = await Rows.json<ResponseJSON>()
    expect(result).toEqual([
      { id: '42', name: 'hello', sku: [0, 1] },
      { id: '43', name: 'world', sku: [3, 4] },
    ])
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
})
