import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { ClickHouseClient } from '@clickhouse/client-common'
import { sql, identifier, TupleParam } from '@clickhouse/client-common'
import { createTestClient } from '../utils'

describe('SQL Template Literals Integration', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  describe('basic queries', () => {
    it('should execute a simple query with string parameter', async () => {
      const name = 'Alice'
      const rs = await client.query(
        sql`SELECT ${name} AS result`,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([{ result: 'Alice' }])
    })

    it('should execute a query with multiple parameters', async () => {
      const val1 = 10
      const val2 = 20
      const rs = await client.query(
        sql`SELECT plus(${val1}, ${val2}) AS result`,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([{ result: '30' }])
    })

    it('should execute a query with boolean parameters', async () => {
      const val1 = true
      const val2 = true
      const rs = await client.query(
        sql`SELECT and(${val1}, ${val2}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('true\n')
    })

    it('should execute a query with number parameters', async () => {
      const minLimit = 2
      const rs = await client.query(
        sql`SELECT number FROM system.numbers WHERE number > ${minLimit} LIMIT 3`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('3\n4\n5\n')
    })

    it('should execute a query with Date parameters', async () => {
      const date = new Date(Date.UTC(2022, 4, 2))
      const rs = await client.query(
        sql`SELECT toDate(${date}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('"2022-05-02"\n')
    })
  })

  describe('identifiers', () => {
    it('should handle table identifiers', async () => {
      const tableName = 'numbers'
      const rs = await client.query(
        sql`SELECT number FROM system.${identifier(tableName)} LIMIT 3`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('0\n1\n2\n')
    })

    it('should handle column identifiers', async () => {
      const columnName = 'number'
      const rs = await client.query(
        sql`SELECT ${identifier(columnName)} FROM system.numbers LIMIT 3`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('0\n1\n2\n')
    })
  })

  describe('arrays', () => {
    it('should handle array of numbers', async () => {
      const arr1 = [1, 2]
      const arr2 = [3, 4]
      const rs = await client.query(
        sql`SELECT arrayConcat(${arr1}, ${arr2}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('"[1,2,3,4]"\n')
    })

    it('should handle array of strings', async () => {
      const arr1 = ['1', '2']
      const arr2 = ['3', '4']
      const rs = await client.query(
        sql`SELECT arrayConcat(${arr1}, ${arr2}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe(`"['1','2','3','4']"\n`)
    })

    it('should use array in WHERE IN clause', async () => {
      const ids = [1, 2, 3]
      const rs = await client.query(
        sql`SELECT number FROM system.numbers WHERE number IN ${ids}`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('1\n2\n3\n')
    })
  })

  describe('special characters', () => {
    it('should escape strings with special characters', async () => {
      const str1 = "co'n"
      const str2 = "ca't"
      const rs = await client.query(
        sql`SELECT concat(${str1}, ${str2}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('"co\'nca\'t"\n')
    })

    it('should handle tab characters', async () => {
      const tab = 'foo_\t_bar'
      const rs = await client.query(
        sql`SELECT 'foo_\t_bar' = ${tab} AS result`,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([{ result: 1 }])
    })

    it('should handle newline characters', async () => {
      const newline = 'foo_\n_bar'
      const rs = await client.query(
        sql`SELECT 'foo_\n_bar' = ${newline} AS result`,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([{ result: 1 }])
    })

    it('should accept non-ASCII symbols', async () => {
      const str1 = '𝓯𝓸𝓸'
      const str2 = '𝓫𝓪𝓻'
      const rs = await client.query(
        sql`SELECT concat(${str1}, ${str2}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('"𝓯𝓸𝓸𝓫𝓪𝓻"\n')
    })
  })

  describe('tuples', () => {
    it('should handle tuple parameters', async () => {
      const tuple = new TupleParam([42, 'foo', "foo_'_bar", 'foo_\t_bar', null])
      const rs = await client.query(
        sql`SELECT ${tuple} AS result`,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([
        {
          result: [42, 'foo', "foo_'_bar", 'foo_\t_bar', null],
        },
      ])
    })
  })

  describe('maps', () => {
    it('should handle Map parameters', async () => {
      const map = new Map([
        [42, ['a', 'b']],
        [144, ['c', 'd']],
      ])
      const rs = await client.query(sql`SELECT ${map} AS result`, 'JSONEachRow')

      const result = await rs.json()
      expect(result).toEqual([
        {
          result: {
            42: ['a', 'b'],
            144: ['c', 'd'],
          },
        },
      ])
    })

    it('should handle plain object as map', async () => {
      const obj = { id: 42 }
      const rs = await client.query(
        sql`SELECT mapKeys(${obj}) AS result`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe(`"['id']"\n`)
    })

    it('should handle maps with nullable values', async () => {
      const map1 = new Map([
        [42, 'foo'],
        [144, 'bar'],
      ])
      const map2 = { foo: 42, bar: 100 }

      const rs = await client.query(
        sql`SELECT ${map1} AS var1, ${map2} AS var2`,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([
        {
          var1: {
            42: 'foo',
            144: 'bar',
          },
          var2: {
            foo: 42,
            bar: 100,
          },
        },
      ])
    })
  })

  describe('null parameters', () => {
    it('should handle null values', async () => {
      const value = null
      const rs = await client.query(
        sql`SELECT number FROM numbers(3) WHERE ${value} IS NULL`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('0\n1\n2\n')
    })
  })

  describe('composability', () => {
    it('should compose multiple SQL templates', async () => {
      const minAge = 18
      const status = 'active'
      const whereAge = sql`number > ${minAge}`
      const whereStatus = sql`number < ${100}`
      const rs = await client.query(
        sql`SELECT number FROM system.numbers WHERE ${whereAge} AND ${whereStatus} LIMIT 3`,
        'CSV',
      )

      const result = await rs.text()
      expect(result).toBe('19\n20\n21\n')
    })

    it('should handle complex nested composition', async () => {
      const limit = 5
      const minValue = 10
      const maxValue = 20

      const rangeFilter = sql`number >= ${minValue} AND number < ${maxValue}`
      const query = sql`SELECT number FROM system.numbers WHERE ${rangeFilter} LIMIT ${limit}`

      const rs = await client.query(query, 'CSV')
      const result = await rs.text()
      expect(result).toBe('10\n11\n12\n13\n14\n')
    })
  })

  describe('with format parameter', () => {
    it('should use specified format from sql call', async () => {
      const rs = await client.query(sql`SELECT 1 AS result`, 'CSV')

      const result = await rs.text()
      expect(result).toBe('1\n')
    })

    it('should default to JSON format when none specified', async () => {
      const rs = await client.query(sql`SELECT 1 AS result`)

      // JSON format returns the full object with data, meta, etc.
      const result = await rs.json()
      expect(result.data).toEqual([{ result: 1 }])
    })
  })

  describe('complex queries', () => {
    it('should handle a realistic query with multiple features', async () => {
      const tableName = 'numbers'
      const ids = [5, 10, 15]
      const multiplier = 2

      const rs = await client.query(
        sql`
          SELECT
            ${identifier('number')} AS id,
            ${identifier('number')} * ${multiplier} AS doubled
          FROM system.${identifier(tableName)}
          WHERE ${identifier('number')} IN ${ids}
        `,
        'JSONEachRow',
      )

      const result = await rs.json()
      expect(result).toEqual([
        { id: '5', doubled: '10' },
        { id: '10', doubled: '20' },
        { id: '15', doubled: '30' },
      ])
    })
  })
})
