import { type ClickHouseClient } from '@clickhouse/client-common'
import { createSimpleTable } from '../fixtures/simple_table'
import { assertJsonValues, jsonValues } from '../fixtures/test_data'
import { createTestClient, guid, validateUUID } from '../utils'

describe('insert', () => {
  let client: ClickHouseClient
  let tableName: string

  beforeEach(async () => {
    client = createTestClient()
    tableName = `insert_test_${guid()}`
    await createSimpleTable(client, tableName)
  })
  afterEach(async () => {
    await client.close()
  })

  it('inserts values using JSON format and get the response headers', async () => {
    const result = await client.insert({
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
    expect(validateUUID(result.query_id)).toBeTruthy()
    expect(result.executed).toBeTruthy()

    // Surprisingly, SMT Cloud instances have a different Content-Type here.
    // Expected 'text/tab-separated-values; charset=UTF-8' to equal 'text/plain; charset=UTF-8'
    expect(
      result.response_headers['Content-Type'] ??
        result.response_headers['content-type'],
    ).toEqual(jasmine.stringMatching(/text\/.+?; charset=UTF-8/))
  })

  it('should use provide query_id', async () => {
    const query_id = guid()
    const result = await client.insert({
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
    expect(result.query_id).toEqual(query_id)
    expect(result.executed).toBeTruthy()
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

    const result = await rs.json()
    expect(result).toEqual(values)
  })

  it('can do multiple inserts simultaneously', async () => {
    await Promise.all(
      jsonValues.map((row) =>
        client.insert({
          values: [row],
          table: tableName,
          format: 'JSONEachRow',
        }),
      ),
    )
    await assertJsonValues(client, tableName)
  })

  it('should provide error details when sending a request with an unknown clickhouse settings', async () => {
    await expectAsync(
      client.insert({
        table: tableName,
        values: jsonValues,
        format: 'JSONEachRow',
        clickhouse_settings: { foobar: 1 } as any,
      }),
    ).toBeRejectedWith(
      jasmine.objectContaining({
        // Possible error messages:
        // Unknown setting foobar
        // Setting foobar is neither a builtin setting nor started with the prefix 'SQL_' registered for user-defined settings.
        message: jasmine.stringContaining('foobar'),
        code: '115',
        type: 'UNKNOWN_SETTING',
      }),
    )
  })

  it('should work with async inserts', async () => {
    await client.insert({
      table: tableName,
      values: jsonValues,
      format: 'JSONEachRow',
      // See https://clickhouse.com/docs/en/optimize/asynchronous-inserts
      clickhouse_settings: {
        async_insert: 1,
        wait_for_async_insert: 1,
      },
    })
    await assertJsonValues(client, tableName)
  })
})
