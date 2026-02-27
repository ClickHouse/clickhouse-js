import { describe, it, expect } from 'vitest'
import { buildMultipartBody } from '../../src/connection/multipart'

describe('[Node.js] buildMultipartBody', () => {
  const boundary = 'test-boundary-123'

  it('should include the SQL query in a "query" part', () => {
    const query = 'SELECT * FROM t WHERE x = {val:String}'
    const result = buildMultipartBody({
      query,
      query_params: { val: 'hello' },
      boundary,
    })
    const body = result.toString()
    expect(body).toContain(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="query"\r\n` +
        `\r\n` +
        `${query}\r\n`,
    )
  })

  it('should include each param as a named "param_*" part with formatted values', () => {
    const result = buildMultipartBody({
      query: 'SELECT 1',
      query_params: {
        name: 'Alice',
        age: 30,
        active: true,
      },
      boundary,
    })
    const body = result.toString()

    expect(body).toContain(
      `Content-Disposition: form-data; name="param_name"\r\n\r\nAlice\r\n`,
    )
    expect(body).toContain(
      `Content-Disposition: form-data; name="param_age"\r\n\r\n30\r\n`,
    )
    expect(body).toContain(
      `Content-Disposition: form-data; name="param_active"\r\n\r\n1\r\n`,
    )
  })

  it('should format array params using formatQueryParams serialization', () => {
    const result = buildMultipartBody({
      query: 'SELECT * FROM t WHERE x IN {values:Array(String)}',
      query_params: {
        values: ['a@b.com', 'c@d.com'],
      },
      boundary,
    })
    const body = result.toString()

    expect(body).toContain(
      `Content-Disposition: form-data; name="param_values"\r\n` +
        `\r\n` +
        `['a@b.com','c@d.com']\r\n`,
    )
  })

  it('should produce valid multipart structure with boundary delimiters', () => {
    const result = buildMultipartBody({
      query: 'SELECT 1',
      query_params: { x: 42 },
      boundary,
    })
    const body = result.toString()

    // Should start with the boundary
    expect(body).toMatch(new RegExp(`^--${boundary}\r\n`))
    // Should end with the closing boundary
    expect(body).toMatch(new RegExp(`--${boundary}--\r\n$`))
  })

  it('should handle multiple params in order', () => {
    const result = buildMultipartBody({
      query: 'SELECT {a:Int32}, {b:String}',
      query_params: { a: 1, b: 'two' },
      boundary,
    })
    const body = result.toString()

    const queryPartIdx = body.indexOf('name="query"')
    const paramAIdx = body.indexOf('name="param_a"')
    const paramBIdx = body.indexOf('name="param_b"')
    const closingIdx = body.indexOf(`--${boundary}--`)

    // query part comes first, then params, then closing boundary
    expect(queryPartIdx).toBeLessThan(paramAIdx)
    expect(paramAIdx).toBeLessThan(paramBIdx)
    expect(paramBIdx).toBeLessThan(closingIdx)
  })

  it('should return a Buffer', () => {
    const result = buildMultipartBody({
      query: 'SELECT 1',
      query_params: { x: 1 },
      boundary,
    })
    expect(Buffer.isBuffer(result)).toBe(true)
  })

  it('should handle special characters in param values', () => {
    const result = buildMultipartBody({
      query: 'SELECT {v:String}',
      query_params: { v: "it's a\ttab\nnewline" },
      boundary,
    })
    const body = result.toString()

    // formatQueryParams escapes these characters
    expect(body).toContain("it\\'s a\\ttab\\nnewline")
  })
})
