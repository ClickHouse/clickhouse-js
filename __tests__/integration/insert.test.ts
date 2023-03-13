import type { ResponseJSON } from '../../src'
import { type ClickHouseClient } from '../../src'
import { createTestClient, guid } from '../utils'
import { createSimpleTable } from './fixtures/simple_table'
import { assertJsonValues, jsonValues } from './fixtures/test_data'
import Stream from 'stream'
import * as uuid from 'uuid'

describe('insert', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = await createTestClient()
    tableName = `insert_test_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('inserts values using JSON format', async () => {
    const { query_id } = await client.insert({
      table: tableName,
      values: {
        meta: [
          {
            name: 'id',
            type: 'UInt64',
          },
          {
            name: 'name',
            type: 'String',
          },
          {
            name: 'sku',
            type: 'Array(UInt8)',
          },
        ],
        data: jsonValues,
      },
      format: 'JSON',
    })
    await assertJsonValues(client, tableName)
    expect(uuid.validate(query_id)).toBeTruthy()
  })

  it('should use provide query_id', async () => {
    const query_id = guid()
    const { query_id: q_id } = await client.insert({
      table: tableName,
      query_id,
      values: {
        meta: [
          {
            name: 'id',
            type: 'UInt64',
          },
          {
            name: 'name',
            type: 'String',
          },
          {
            name: 'sku',
            type: 'Array(UInt8)',
          },
        ],
        data: jsonValues,
      },
      format: 'JSON',
    })
    await assertJsonValues(client, tableName)
    expect(query_id).toEqual(q_id)
  })

  it('inserts values using JSONObjectEachRow format', async () => {
    await client.insert({
      table: tableName,
      values: {
        a: { id: '42', name: 'hello', sku: [0, 1] },
        b: { id: '43', name: 'world', sku: [2, 3] },
        c: { id: '44', name: 'foo', sku: [3, 4] },
        d: { id: '45', name: 'bar', sku: [4, 5] },
        e: { id: '46', name: 'baz', sku: [6, 7] },
      },
      format: 'JSONObjectEachRow',
    })
    await assertJsonValues(client, tableName)
  })

  it('can insert strings with non-ASCII symbols', async () => {
    const values = [
      { id: '42', name: '🅷🅴🅻🅻🅾', sku: [0, 1] },
      { id: '43', name: '🆆🅾🆁🅻🅳 ♥', sku: [3, 4] },
    ]
    await client.insert({
      table: tableName,
      values,
      format: 'JSONEachRow',
    })

    const rs = await client.query({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    })

    const result = await rs.json<ResponseJSON>()
    expect(result).toEqual(values)
  })

  it('can do multiple inserts simultaneously', async () => {
    await Promise.all(
      jsonValues.map((row) =>
        client.insert({
          values: [row],
          table: tableName,
          format: 'JSONEachRow',
        })
      )
    )
    await assertJsonValues(client, tableName)
  })

  it('should provide error details when sending a request with an unknown clickhouse settings', async () => {
    await expect(
      client.insert({
        table: tableName,
        values: jsonValues,
        format: 'JSONEachRow',
        clickhouse_settings: { foobar: 1 } as any,
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Unknown setting foobar'),
        code: '115',
        type: 'UNKNOWN_SETTING',
      })
    )
  })

  it('should provide error details about a dataset with an invalid type', async () => {
    await expect(
      client.insert({
        table: tableName,
        values: Stream.Readable.from(['42,foobar,"[1,2]"'], {
          objectMode: false,
        }),
        format: 'TabSeparated',
      })
    ).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Cannot parse input'),
        code: '27',
        type: 'CANNOT_PARSE_INPUT_ASSERTION_FAILED',
      })
    )
  })
})
