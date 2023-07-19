import {
  type ClickHouseClient,
  type ResponseJSON,
} from '@clickhouse/client-common'
import { createTestClient, guid, validateUUID } from '../utils'

describe('select', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })
  beforeEach(async () => {
    client = createTestClient()
  })

  it('gets query_id back', async () => {
    const resultSet = await client.query({
      query: 'SELECT * FROM system.numbers LIMIT 1',
      format: 'JSONEachRow',
    })
    expect(await resultSet.json()).toEqual([{ number: '0' }])
    expect(validateUUID(resultSet.query_id)).toBeTruthy()
  })

  it('can override query_id', async () => {
    const query_id = guid()
    const resultSet = await client.query({
      query: 'SELECT * FROM system.numbers LIMIT 1',
      format: 'JSONEachRow',
      query_id,
    })
    expect(await resultSet.json()).toEqual([{ number: '0' }])
    expect(resultSet.query_id).toEqual(query_id)
  })

  it('can process an empty response', async () => {
    expect(
      await client
        .query({
          query: 'SELECT * FROM system.numbers LIMIT 0',
          format: 'JSONEachRow',
        })
        .then((r) => r.json())
    ).toEqual([])
    expect(
      await client
        .query({
          query: 'SELECT * FROM system.numbers LIMIT 0',
          format: 'TabSeparated',
        })
        .then((r) => r.text())
    ).toEqual('')
  })

  it('can send a multiline query', async () => {
    const rs = await client.query({
      query: `
        SELECT number
        FROM system.numbers
        LIMIT 2
      `,
      format: 'CSV',
    })

    const response = await rs.text()
    expect(response).toBe('0\n1\n')
  })

  it('can send a query with an inline comment', async () => {
    const rs = await client.query({
      query: `
        SELECT number
        -- a comment
        FROM system.numbers
        LIMIT 2
      `,
      format: 'CSV',
    })

    const response = await rs.text()
    expect(response).toBe('0\n1\n')
  })

  it('can send a query with a multiline comment', async () => {
    const rs = await client.query({
      query: `
        SELECT number
        /* This is:
         a multiline comment
        */
        FROM system.numbers
        LIMIT 2
      `,
      format: 'CSV',
    })

    const response = await rs.text()
    expect(response).toBe('0\n1\n')
  })

  it('can send a query with a trailing comment', async () => {
    const rs = await client.query({
      query: `
        SELECT number
        FROM system.numbers
        LIMIT 2
        -- comment`,
      format: 'JSON',
    })

    const response = await rs.json<ResponseJSON<{ number: string }>>()
    expect(response.data).toEqual([{ number: '0' }, { number: '1' }])
  })

  it('can specify settings in select', async () => {
    const rs = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 5',
      format: 'CSV',
      clickhouse_settings: {
        limit: '2',
      },
    })

    const response = await rs.text()
    expect(response).toBe('0\n1\n')
  })

  it('does not swallow a client error', async () => {
    await expectAsync(
      client.query({ query: 'SELECT number FR' })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        type: 'UNKNOWN_IDENTIFIER',
      })
    )
  })

  it('returns an error details provided by ClickHouse', async () => {
    await expectAsync(client.query({ query: 'foobar' })).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Syntax error'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })

  it('should provide error details when sending a request with an unknown clickhouse settings', async () => {
    await expectAsync(
      client.query({
        query: 'SELECT * FROM system.numbers',
        clickhouse_settings: { foobar: 1 } as any,
      })
    ).toBeRejectedWith(
      jasmine.objectContaining({
        message: jasmine.stringContaining('Unknown setting foobar'),
        code: '115',
        type: 'UNKNOWN_SETTING',
      })
    )
  })

  it('can send multiple simultaneous requests', async () => {
    type Res = Array<{ sum: number }>
    const results: number[] = []
    await Promise.all(
      [...Array(5)].map((_, i) =>
        client
          .query({
            query: `SELECT toInt32(sum(*)) AS sum FROM numbers(0, ${i + 2});`,
            format: 'JSONEachRow',
          })
          .then((r) => r.json<Res>())
          .then((json: Res) => results.push(json[0].sum))
      )
    )
    expect(results.sort((a, b) => a - b)).toEqual([1, 3, 6, 10, 15])
  })

  describe('trailing semi', () => {
    it('should allow queries with trailing semicolon', async () => {
      const numbers = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 3;',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })

    it('should allow queries with multiple trailing semicolons', async () => {
      const numbers = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 3;;;;;;;;;;;;;;;;;',
        format: 'CSV',
      })
      expect(await numbers.text()).toEqual('0\n1\n2\n')
    })

    it('should allow semi in select clause', async () => {
      const resultSet = await client.query({
        query: `SELECT ';'`,
        format: 'CSV',
      })
      expect(await resultSet.text()).toEqual('";"\n')
    })
  })
})
