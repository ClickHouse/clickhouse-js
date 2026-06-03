import { describe, expect, it } from 'vitest'
import { splitQueries } from '../src/split-queries.js'

describe('splitQueries', () => {
  it('splits two simple statements', () => {
    expect(splitQueries('SELECT 1; SELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('ignores a trailing semicolon', () => {
    expect(splitQueries('SELECT 1;')).toEqual(['SELECT 1'])
  })

  it('handles a single statement without trailing semicolon', () => {
    expect(splitQueries('SELECT 1')).toEqual(['SELECT 1'])
  })

  it('returns [] for an empty string', () => {
    expect(splitQueries('')).toEqual([])
  })

  it('returns [] for whitespace-only input', () => {
    expect(splitQueries('   \n\t  ')).toEqual([])
  })

  it('does not split on semicolons inside single quotes', () => {
    expect(splitQueries("SELECT ';'; SELECT 2")).toEqual([
      "SELECT ';'",
      'SELECT 2',
    ])
  })

  it('does not split on semicolons inside double quotes', () => {
    expect(splitQueries('SELECT ";"; SELECT 2')).toEqual([
      'SELECT ";"',
      'SELECT 2',
    ])
  })

  it('does not split on semicolons inside backticks', () => {
    expect(splitQueries('SELECT `a;b`; SELECT 2')).toEqual([
      'SELECT `a;b`',
      'SELECT 2',
    ])
  })

  it('handles escaped quote inside a single-quoted string', () => {
    expect(splitQueries("SELECT '\\''; SELECT 2")).toEqual([
      "SELECT '\\''",
      'SELECT 2',
    ])
  })

  it('trims whitespace around statements', () => {
    expect(splitQueries('  SELECT 1  ;  SELECT 2  ')).toEqual([
      'SELECT 1',
      'SELECT 2',
    ])
  })

  it('ignores apostrophes and semicolons inside line comments', () => {
    const sql =
      "-- defeat the test's purpose; really\nSELECT 1;\nSYSTEM FLUSH LOGS query_log;\nSELECT 2"
    expect(splitQueries(sql)).toEqual([
      "-- defeat the test's purpose; really\nSELECT 1",
      'SYSTEM FLUSH LOGS query_log',
      'SELECT 2',
    ])
  })

  it('ignores apostrophes and semicolons inside block comments', () => {
    const sql = "/* it's a; trap */ SELECT 1; SELECT 2"
    expect(splitQueries(sql)).toEqual([
      "/* it's a; trap */ SELECT 1",
      'SELECT 2',
    ])
  })
})
