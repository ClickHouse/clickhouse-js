import { describe, expect, it } from 'vitest'
import { compile, ident, param, sql } from '../../src/index.js'

describe('sql template tag', () => {
  it('inlines safe numeric / boolean / short ASCII string literals', () => {
    const { sql: text, params } = compile(
      sql`SELECT ${1}, ${true}, ${'hi'} WHERE x = ${42}`,
    )
    expect(text).toBe("SELECT 1, true, 'hi' WHERE x = 42")
    expect(params).toEqual({})
  })

  it('parameterises strings with control characters or non-ASCII bytes', () => {
    const { sql: text, params } = compile(sql`SELECT ${'héllo\nworld'}`)
    expect(text).toBe('SELECT {p0:String}')
    expect(params).toEqual({ p0: 'héllo\nworld' })
  })

  it('parameterises Date as DateTime64(3) by default', () => {
    const d = new Date(0)
    const { sql: text, params } = compile(sql`SELECT ${d}`)
    expect(text).toBe('SELECT {p0:DateTime64(3)}')
    expect(params.p0).toBe(d)
  })

  it('honours explicit param() type tags', () => {
    const { sql: text, params } = compile(
      sql`SELECT ${param(42, 'UInt32')}, ${param(null, 'Nullable(String)')}`,
    )
    expect(text).toBe('SELECT {p0:UInt32}, {p1:Nullable(String)}')
    expect(params).toEqual({ p0: 42, p1: null })
  })

  it('quotes identifiers via ident()', () => {
    const { sql: text } = compile(
      sql`SELECT ${ident('a.b')} FROM ${ident('db.users')}`,
    )
    expect(text).toBe('SELECT `a`.`b` FROM `db`.`users`')
  })

  it('refuses to bind null/undefined without an explicit type', () => {
    expect(() => compile(sql`SELECT ${null}`)).toThrow(/cannot infer type/i)
    expect(() => compile(sql`SELECT ${undefined}`)).toThrow(/cannot infer type/i)
  })

  it('infers Array element type from the first item', () => {
    const { sql: text, params } = compile(sql`SELECT ${[1, 2, 3]}`)
    expect(text).toBe('SELECT {p0:Array(Int64)}')
    expect(params).toEqual({ p0: [1, 2, 3] })
  })

  it('nests SQL fragments without re-numbering placeholders incorrectly', () => {
    const inner = sql`x = ${'a long-ish value that should be parameterised because it contains spaces and is intentionally over sixty-four bytes long.'}`
    const { sql: text, params } = compile(sql`SELECT * WHERE ${inner} AND y = ${999}`)
    expect(text).toMatch(/SELECT \* WHERE x = \{p0:String\} AND y = 999/)
    expect(Object.keys(params)).toEqual(['p0'])
  })
})
