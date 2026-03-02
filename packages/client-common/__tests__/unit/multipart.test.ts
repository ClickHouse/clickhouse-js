import { describe, it, expect } from 'vitest'
import { buildMultipartBody } from '../../src/utils/multipart'

describe('buildMultipartBody', () => {
  const boundary = '----test-boundary'

  it('should build a multipart body with query and one param', () => {
    const result = buildMultipartBody({
      query: 'SELECT * FROM t WHERE x = {val:String}',
      query_params: { val: 'hello' },
      boundary,
    })

    expect(result).toBe(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="query"\r\n` +
        `\r\n` +
        `SELECT * FROM t WHERE x = {val:String}\r\n` +
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="param_val"\r\n` +
        `\r\n` +
        `hello\r\n` +
        `--${boundary}--\r\n`,
    )
  })

  it('should build a multipart body with multiple params', () => {
    const result = buildMultipartBody({
      query: 'SELECT * FROM t WHERE a = {x:UInt32} AND b = {y:String}',
      query_params: { x: 42, y: 'test' },
      boundary,
    })

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_x"\r\n\r\n42\r\n`,
    )
    expect(result).toContain(
      `Content-Disposition: form-data; name="param_y"\r\n\r\ntest\r\n`,
    )
    expect(result).toContain(
      `Content-Disposition: form-data; name="query"\r\n\r\nSELECT * FROM t WHERE a = {x:UInt32} AND b = {y:String}\r\n`,
    )
    expect(result).toMatch(new RegExp(`--${boundary}--\\r\\n$`))
  })

  it('should handle array params', () => {
    const result = buildMultipartBody({
      query: 'SELECT * FROM t WHERE x IN {values:Array(String)}',
      query_params: { values: ['a', 'b', 'c'] },
      boundary,
    })

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_values"\r\n\r\n['a','b','c']\r\n`,
    )
  })

  it('should handle boolean params', () => {
    const result = buildMultipartBody({
      query: 'SELECT * FROM t WHERE flag = {flag:Boolean}',
      query_params: { flag: true },
      boundary,
    })

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_flag"\r\n\r\n1\r\n`,
    )
  })

  it('should handle null params', () => {
    const result = buildMultipartBody({
      query: 'SELECT * FROM t WHERE x = {x:Nullable(String)}',
      query_params: { x: null },
      boundary,
    })

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_x"\r\n\r\n\\N\r\n`,
    )
  })

  it('should return a string', () => {
    const result = buildMultipartBody({
      query: 'SELECT 1',
      query_params: { val: 'test' },
      boundary,
    })
    expect(typeof result).toBe('string')
  })

  it('should handle empty query_params', () => {
    const result = buildMultipartBody({
      query: 'SELECT 1',
      query_params: {},
      boundary,
    })

    expect(result).toBe(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="query"\r\n` +
        `\r\n` +
        `SELECT 1\r\n` +
        `--${boundary}--\r\n`,
    )
  })

  it('should reject param names with special characters', () => {
    expect(() =>
      buildMultipartBody({
        query: 'SELECT 1',
        query_params: { 'bad name': 'value' },
        boundary,
      }),
    ).toThrow('Invalid query parameter name: "bad name"')
  })

  it('should reject param names with quotes', () => {
    expect(() =>
      buildMultipartBody({
        query: 'SELECT 1',
        query_params: { 'key"injection': 'value' },
        boundary,
      }),
    ).toThrow('Invalid query parameter name: "key"injection"')
  })

  it('should reject param names with newlines', () => {
    expect(() =>
      buildMultipartBody({
        query: 'SELECT 1',
        query_params: { 'key\r\ninjection': 'value' },
        boundary,
      }),
    ).toThrow(/Invalid query parameter name/)
  })

  it('should accept param names with underscores and digits', () => {
    const result = buildMultipartBody({
      query: 'SELECT {my_param_123:String}',
      query_params: { my_param_123: 'ok' },
      boundary,
    })

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_my_param_123"\r\n`,
    )
  })
})
