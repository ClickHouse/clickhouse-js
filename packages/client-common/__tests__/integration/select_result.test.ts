import type { ClickHouseClient, ResponseJSON } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('Select ResultSet', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })
  beforeEach(async () => {
    client = createTestClient()
  })

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

      const { data: nums } = await rs.json<{ number: string }>()
      expect(Array.isArray(nums)).toBe(true)
      expect(nums.length).toEqual(5)
      const values = nums.map((i) => i.number)
      expect(values).toEqual(['0', '1', '2', '3', '4'])
    })

    it('returns columns data in response', async () => {
      const rs = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 5',
        format: 'JSON',
      })

      const { meta } = await rs.json<{ number: string }>()

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
        jasmine.objectContaining({
          statistics: {
            elapsed: jasmine.any(Number),
            rows_read: jasmine.any(Number),
            bytes_read: jasmine.any(Number),
          },
        })
      )
    })
  })
})
