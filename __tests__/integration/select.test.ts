import type Stream from 'stream'
import { type ClickHouseClient, type ResponseJSON, type Row } from '../../src'
import { createTestClient, guid } from '../utils'
import * as uuid from 'uuid'

async function rowsValues(stream: Stream.Readable): Promise<any[]> {
  const result: any[] = []
  for await (const rows of stream) {
    rows.forEach((row: Row) => {
      result.push(row.json())
    })
  }
  return result
}

async function rowsText(stream: Stream.Readable): Promise<string[]> {
  const result: string[] = []
  for await (const rows of stream) {
    rows.forEach((row: Row) => {
      result.push(row.text)
    })
  }
  return result
}

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
    expect(uuid.validate(resultSet.query_id)).toBeTruthy()
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

  describe('consume the response only once', () => {
    async function assertAlreadyConsumed$<T>(fn: () => Promise<T>) {
      await expect(fn()).rejects.toMatchObject(
        expect.objectContaining({
          message: 'Stream has been already consumed',
        })
      )
    }
    function assertAlreadyConsumed<T>(fn: () => T) {
      expect(fn).toThrow(
        expect.objectContaining({
          message: 'Stream has been already consumed',
        })
      )
    }
    it('should consume a JSON response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'JSONEachRow',
      })
      expect(await rs.json()).toEqual([{ number: '0' }])
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })

    it('should consume a text response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'TabSeparated',
      })
      expect(await rs.text()).toEqual('0\n')
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })

    it('should consume a stream response only once', async () => {
      const rs = await client.query({
        query: 'SELECT * FROM system.numbers LIMIT 1',
        format: 'TabSeparated',
      })
      let result = ''
      for await (const rows of rs.stream()) {
        rows.forEach((row: Row) => {
          result += row.text
        })
      }
      expect(result).toEqual('0')
      // wrap in a func to avoid changing inner "this"
      await assertAlreadyConsumed$(() => rs.json())
      await assertAlreadyConsumed$(() => rs.text())
      await assertAlreadyConsumed(() => rs.stream())
    })
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
    await expect(client.query({ query: 'SELECT number FR' })).rejects.toEqual(
      expect.objectContaining({
        type: 'UNKNOWN_IDENTIFIER',
      })
    )
  })

  it('returns an error details provided by ClickHouse', async () => {
    await expect(client.query({ query: 'foobar' })).rejects.toEqual(
      expect.objectContaining({
        message: expect.stringContaining('Syntax error'),
        code: '62',
        type: 'SYNTAX_ERROR',
      })
    )
  })

  it('should provide error details when sending a request with an unknown clickhouse settings', async () => {
    await expect(
      client.query({
        query: 'SELECT * FROM system.numbers',
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

  describe('select result', () => {
    describe('text()', function () {
      it('returns values from SELECT query in specified format', async () => {
        const rs = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'CSV',
        })

        expect(await rs.text()).toBe('0\n1\n2\n')
      })
      it('returns values from SELECT query in specified format', async () => {
        const rs = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 3',
          format: 'JSONEachRow',
        })

        expect(await rs.text()).toBe(
          '{"number":"0"}\n{"number":"1"}\n{"number":"2"}\n'
        )
      })
    })

    describe('json()', () => {
      it('returns an array of values in data property', async () => {
        const rs = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const { data: nums } = await rs.json<ResponseJSON<{ number: string }>>()
        expect(Array.isArray(nums)).toBe(true)
        expect(nums).toHaveLength(5)
        const values = nums.map((i) => i.number)
        expect(values).toEqual(['0', '1', '2', '3', '4'])
      })

      it('returns columns data in response', async () => {
        const rs = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const { meta } = await rs.json<ResponseJSON<{ number: string }>>()

        expect(meta?.length).toBe(1)
        const column = meta ? meta[0] : undefined
        expect(column).toEqual({
          name: 'number',
          type: 'UInt64',
        })
      })

      it('returns number of rows in response', async () => {
        const rs = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const response = await rs.json<ResponseJSON<{ number: string }>>()

        expect(response.rows).toBe(5)
      })

      it('returns statistics in response', async () => {
        const rs = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSON',
        })

        const response = await rs.json<ResponseJSON<{ number: string }>>()
        expect(response).toEqual(
          expect.objectContaining({
            statistics: {
              elapsed: expect.any(Number),
              rows_read: expect.any(Number),
              bytes_read: expect.any(Number),
            },
          })
        )
      })
    })
  })

  describe('select result asStream()', () => {
    it('throws an exception if format is not stream-able', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON',
      })
      try {
        expect(() => result.stream()).toThrowError(
          'JSON format is not streamable'
        )
      } finally {
        result.close()
      }
    })

    it('can pause response stream', async () => {
      const result = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 10000',
        format: 'CSV',
      })

      const stream = result.stream()

      let last = null
      let i = 0
      for await (const rows of stream) {
        rows.forEach((row: Row) => {
          last = row.text
          i++
          if (i % 1000 === 0) {
            stream.pause()
            setTimeout(() => stream.resume(), 100)
          }
        })
      }
      expect(last).toBe('9999')
    })

    describe('text()', () => {
      it('returns stream of rows in CSV format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'CSV',
        })

        const rs = await rowsText(result.stream())
        expect(rs).toEqual(['0', '1', '2', '3', '4'])
      })

      it('returns stream of rows in TabSeparated format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'TabSeparated',
        })

        const rs = await rowsText(result.stream())
        expect(rs).toEqual(['0', '1', '2', '3', '4'])
      })
    })

    describe('json()', () => {
      it('returns stream of objects in JSONEachRow format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONEachRow',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([
          { number: '0' },
          { number: '1' },
          { number: '2' },
          { number: '3' },
          { number: '4' },
        ])
      })

      it('returns stream of objects in JSONStringsEachRow format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONStringsEachRow',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([
          { number: '0' },
          { number: '1' },
          { number: '2' },
          { number: '3' },
          { number: '4' },
        ])
      })

      it('returns stream of objects in JSONCompactEachRow format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRow',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactEachRowWithNames format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNames',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactEachRowWithNamesAndTypes format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactEachRowWithNamesAndTypes',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([
          ['number'],
          ['UInt64'],
          ['0'],
          ['1'],
          ['2'],
          ['3'],
          ['4'],
        ])
      })

      it('returns stream of objects in JSONCompactStringsEachRowWithNames format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNames',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([['number'], ['0'], ['1'], ['2'], ['3'], ['4']])
      })

      it('returns stream of objects in JSONCompactStringsEachRowWithNamesAndTypes format', async () => {
        const result = await client.query({
          query: 'SELECT number FROM system.numbers LIMIT 5',
          format: 'JSONCompactStringsEachRowWithNamesAndTypes',
        })

        const rs = await rowsValues(result.stream())
        expect(rs).toEqual([
          ['number'],
          ['UInt64'],
          ['0'],
          ['1'],
          ['2'],
          ['3'],
          ['4'],
        ])
      })
    })
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
