import { describe, it, expect } from 'vitest'
import {
  sql,
  identifier,
  isSQLTemplate,
  isSQLIdentifier,
  inferClickHouseType,
  SQLIdentifier,
  type SQLTemplate,
} from '../../src/sql_template'
import { TupleParam } from '../../src/data_formatter'

describe('SQL Template Literals', () => {
  describe('sql tagged template function', () => {
    it('should create a basic SQL template with string parameter', () => {
      const userName = 'Alice'
      const result = sql`SELECT * FROM users WHERE name = ${userName}`

      expect(isSQLTemplate(result)).toBe(true)
      expect(result.query).toBe(
        'SELECT * FROM users WHERE name = {__p0: String}',
      )
      expect(result.query_params).toEqual({ __p0: 'Alice' })
    })

    it('should create a SQL template with multiple parameters', () => {
      const userName = 'Alice'
      const age = 30
      const result = sql`SELECT * FROM users WHERE name = ${userName} AND age = ${age}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE name = {__p0: String} AND age = {__p1: Int32}',
      )
      expect(result.query_params).toEqual({ __p0: 'Alice', __p1: 30 })
    })

    it('should handle boolean parameters', () => {
      const active = true
      const result = sql`SELECT * FROM users WHERE active = ${active}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE active = {__p0: Boolean}',
      )
      expect(result.query_params).toEqual({ __p0: true })
    })

    it('should handle number parameters with correct type inference', () => {
      const int32Value = 42
      const int64Value = 3000000000
      const floatValue = 3.14

      const result1 = sql`SELECT ${int32Value}`
      expect(result1.query).toBe('SELECT {__p0: Int32}')
      expect(result1.query_params).toEqual({ __p0: 42 })

      const result2 = sql`SELECT ${int64Value}`
      expect(result2.query).toBe('SELECT {__p0: Int64}')
      expect(result2.query_params).toEqual({ __p0: 3000000000 })

      const result3 = sql`SELECT ${floatValue}`
      expect(result3.query).toBe('SELECT {__p0: Float64}')
      expect(result3.query_params).toEqual({ __p0: 3.14 })
    })

    it('should handle Date parameters', () => {
      const date = new Date('2023-01-01T12:00:00Z')
      const result = sql`SELECT * FROM events WHERE created > ${date}`

      expect(result.query).toBe(
        'SELECT * FROM events WHERE created > {__p0: DateTime}',
      )
      expect(result.query_params).toEqual({ __p0: date })
    })

    it('should handle array parameters', () => {
      const ids = [1, 2, 3]
      const result = sql`SELECT * FROM users WHERE id IN ${ids}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE id IN {__p0: Array(Int32)}',
      )
      expect(result.query_params).toEqual({ __p0: [1, 2, 3] })
    })

    it('should handle string array parameters', () => {
      const names = ['Alice', 'Bob', 'Charlie']
      const result = sql`SELECT * FROM users WHERE name IN ${names}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE name IN {__p0: Array(String)}',
      )
      expect(result.query_params).toEqual({ __p0: names })
    })

    it('should handle null parameters', () => {
      const value = null
      const result = sql`SELECT * FROM users WHERE deleted_at IS ${value}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE deleted_at IS {__p0: Nullable(String)}',
      )
      expect(result.query_params).toEqual({ __p0: null })
    })

    it('should handle tuple parameters', () => {
      const tuple = new TupleParam([42, 'foo'])
      const result = sql`SELECT ${tuple}`

      expect(result.query).toBe('SELECT {__p0: Tuple(Int32, String)}')
      expect(result.query_params).toEqual({ __p0: tuple })
    })

    it('should handle Map parameters', () => {
      const map = new Map([
        ['key1', 1],
        ['key2', 2],
      ])
      const result = sql`SELECT ${map}`

      expect(result.query).toBe('SELECT {__p0: Map(String, Int32)}')
      expect(result.query_params).toEqual({ __p0: map })
    })

    it('should handle plain object parameters as maps', () => {
      const obj = { id: 42, name: 'Alice' }
      const result = sql`SELECT ${obj}`

      expect(result.query).toBe('SELECT {__p0: Map(String, Int32)}')
      expect(result.query_params).toEqual({ __p0: obj })
    })

    it('should throw error for empty arrays', () => {
      const emptyArray: number[] = []
      expect(() => sql`SELECT ${emptyArray}`).toThrow(
        'Cannot infer ClickHouse type from empty array',
      )
    })

    it('should throw error for empty Maps', () => {
      const emptyMap = new Map()
      expect(() => sql`SELECT ${emptyMap}`).toThrow(
        'Cannot infer ClickHouse type from empty Map',
      )
    })
  })

  describe('identifier helper', () => {
    it('should create an SQLIdentifier', () => {
      const id = identifier('users')
      expect(isSQLIdentifier(id)).toBe(true)
      expect(id.name).toBe('users')
    })

    it('should use Identifier type in sql template', () => {
      const tableName = 'users'
      const result = sql`SELECT * FROM ${identifier(tableName)}`

      expect(result.query).toBe('SELECT * FROM {__p0: Identifier}')
      expect(result.query_params).toEqual({ __p0: 'users' })
    })

    it('should handle multiple identifiers', () => {
      const table = 'users'
      const column = 'name'
      const result = sql`SELECT ${identifier(column)} FROM ${identifier(table)}`

      expect(result.query).toBe(
        'SELECT {__p0: Identifier} FROM {__p1: Identifier}',
      )
      expect(result.query_params).toEqual({ __p0: 'name', __p1: 'users' })
    })
  })

  describe('composability', () => {
    it('should merge nested SQL templates', () => {
      const condition1 = sql`age > ${18}`
      const condition2 = sql`status = ${'active'}`
      const result = sql`SELECT * FROM users WHERE ${condition1} AND ${condition2}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE age > {__p0: Int32} AND status = {__p1: String}',
      )
      expect(result.query_params).toEqual({ __p0: 18, __p1: 'active' })
    })

    it('should handle complex nested templates', () => {
      const whereClause = sql`name = ${'Alice'} AND age = ${30}`
      const orderBy = sql`ORDER BY ${identifier('created_at')}`
      const result = sql`SELECT * FROM users WHERE ${whereClause} ${orderBy}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE name = {__p0: String} AND age = {__p1: Int32} ORDER BY {__p2: Identifier}',
      )
      expect(result.query_params).toEqual({
        __p0: 'Alice',
        __p1: 30,
        __p2: 'created_at',
      })
    })

    it('should handle deeply nested templates', () => {
      const innerCondition = sql`role = ${'admin'}`
      const middleCondition = sql`${innerCondition} AND verified = ${true}`
      const result = sql`SELECT * FROM users WHERE ${middleCondition}`

      expect(result.query).toBe(
        'SELECT * FROM users WHERE role = {__p0: String} AND verified = {__p1: Boolean}',
      )
      expect(result.query_params).toEqual({ __p0: 'admin', __p1: true })
    })
  })

  describe('type inference', () => {
    it('should infer String type', () => {
      expect(inferClickHouseType('hello')).toBe('String')
    })

    it('should infer Boolean type', () => {
      expect(inferClickHouseType(true)).toBe('Boolean')
      expect(inferClickHouseType(false)).toBe('Boolean')
    })

    it('should infer Int32 for small integers', () => {
      expect(inferClickHouseType(42)).toBe('Int32')
      expect(inferClickHouseType(-100)).toBe('Int32')
      expect(inferClickHouseType(2147483647)).toBe('Int32')
      expect(inferClickHouseType(-2147483648)).toBe('Int32')
    })

    it('should infer Int64 for large integers', () => {
      expect(inferClickHouseType(2147483648)).toBe('Int64')
      expect(inferClickHouseType(-2147483649)).toBe('Int64')
    })

    it('should infer Float64 for floats', () => {
      expect(inferClickHouseType(3.14)).toBe('Float64')
      expect(inferClickHouseType(-2.5)).toBe('Float64')
    })

    it('should infer Int64 for BigInt', () => {
      expect(inferClickHouseType(BigInt(100))).toBe('Int64')
    })

    it('should infer DateTime for Date objects', () => {
      expect(inferClickHouseType(new Date())).toBe('DateTime')
    })

    it('should infer Array types', () => {
      expect(inferClickHouseType([1, 2, 3])).toBe('Array(Int32)')
      expect(inferClickHouseType(['a', 'b'])).toBe('Array(String)')
      expect(inferClickHouseType([true, false])).toBe('Array(Boolean)')
    })

    it('should infer Tuple types', () => {
      const tuple = new TupleParam([42, 'hello', true])
      expect(inferClickHouseType(tuple)).toBe('Tuple(Int32, String, Boolean)')
    })

    it('should infer Map types', () => {
      const map = new Map([
        ['key', 42],
        ['key2', 100],
      ])
      expect(inferClickHouseType(map)).toBe('Map(String, Int32)')
    })

    it('should infer Map type for plain objects', () => {
      expect(inferClickHouseType({ id: 42 })).toBe('Map(String, Int32)')
      expect(inferClickHouseType({ name: 'Alice' })).toBe('Map(String, String)')
    })

    it('should infer Nullable(String) for null/undefined', () => {
      expect(inferClickHouseType(null)).toBe('Nullable(String)')
      expect(inferClickHouseType(undefined)).toBe('Nullable(String)')
    })

    it('should infer Identifier type for SQLIdentifier', () => {
      expect(inferClickHouseType(new SQLIdentifier('users'))).toBe('Identifier')
    })

    it('should throw for unsupported types', () => {
      expect(() => inferClickHouseType(Symbol('test'))).toThrow(
        'Cannot infer ClickHouse type',
      )
    })
  })

  describe('type guards', () => {
    it('isSQLTemplate should detect SQL templates', () => {
      const template = sql`SELECT 1`
      expect(isSQLTemplate(template)).toBe(true)

      expect(isSQLTemplate({})).toBe(false)
      expect(isSQLTemplate(null)).toBe(false)
      expect(isSQLTemplate('string')).toBe(false)
      expect(isSQLTemplate({ query: 'SELECT 1' })).toBe(false)
    })

    it('isSQLIdentifier should detect SQL identifiers', () => {
      const id = identifier('users')
      expect(isSQLIdentifier(id)).toBe(true)

      expect(isSQLIdentifier('users')).toBe(false)
      expect(isSQLIdentifier({})).toBe(false)
      expect(isSQLIdentifier(null)).toBe(false)
    })
  })

  describe('edge cases', () => {
    it('should handle templates with no parameters', () => {
      const result = sql`SELECT 1`
      expect(result.query).toBe('SELECT 1')
      expect(result.query_params).toEqual({})
    })

    it('should trim whitespace from query', () => {
      const result = sql`
        SELECT *
        FROM users
      `
      expect(result.query.trim()).toBe('SELECT *\n        FROM users')
    })

    it('should handle consecutive parameters', () => {
      const result = sql`SELECT ${1}, ${2}, ${3}`
      expect(result.query).toBe(
        'SELECT {__p0: Int32}, {__p1: Int32}, {__p2: Int32}',
      )
      expect(result.query_params).toEqual({ __p0: 1, __p1: 2, __p2: 3 })
    })

    it('should handle parameters at the start and end', () => {
      const result = sql`${identifier('name')} FROM users WHERE id = ${42}`
      expect(result.query).toBe(
        '{__p0: Identifier} FROM users WHERE id = {__p1: Int32}',
      )
      expect(result.query_params).toEqual({ __p0: 'name', __p1: 42 })
    })

    it('should handle nested arrays', () => {
      const nestedArray = [
        [1, 2],
        [3, 4],
      ]
      const result = sql`SELECT ${nestedArray}`
      expect(result.query).toBe('SELECT {__p0: Array(Array(Int32))}')
      expect(result.query_params).toEqual({ __p0: nestedArray })
    })
  })
})
