import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('Select ResultSet', () => {
  let client: ClickHouseClient
  afterEach(async () => {
    await client.close()
  })
  beforeEach(async () => {
    client = createTestClient()
  })

  describe('text() method', function () {
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
        '{"number":"0"}\n{"number":"1"}\n{"number":"2"}\n',
      )
    })
  })

  describe('json() method', () => {
    interface Data {
      number: string
    }

    it('should have correct fields in the response for JSON format', async () => {
      const rs = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'JSON',
      })
      const responseJSON = await rs.json<Data>()
      expect(Array.isArray(responseJSON.data)).toBe(true)
      expect(responseJSON).toEqual({
        data: [{ number: '0' }, { number: '1' }, { number: '2' }],
        meta: [{ name: 'number', type: 'UInt64' }],
        rows: 3,
        rows_before_limit_at_least: 3,
        statistics: {
          elapsed: expect.any(Number),
          rows_read: expect.any(Number),
          bytes_read: expect.any(Number),
        },
      })
    })
  })
})
