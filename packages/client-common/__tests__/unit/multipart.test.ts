import { describe, it, expect } from 'vitest'
import { buildMultipartBody } from '../../src/utils/multipart'

describe('buildMultipartBody', () => {
  const boundary = '----test-boundary'

  it('should build a multipart body with one part', () => {
    const result = buildMultipartBody({ query: 'SELECT 1' }, boundary)

    expect(result).toMatchInlineSnapshot(`
      "------test-boundary
      Content-Disposition: form-data; name="query"

      SELECT 1
      ------test-boundary--
      "
    `)
  })

  it('should build a multipart body with multiple parts', () => {
    const result = buildMultipartBody(
      {
        query: 'SELECT * FROM t WHERE a = {x:UInt32} AND b = {y:String}',
        param_x: '42',
        param_y: 'test',
      },
      boundary,
    )

    expect(result).toMatchInlineSnapshot(`
      "------test-boundary
      Content-Disposition: form-data; name="query"

      SELECT * FROM t WHERE a = {x:UInt32} AND b = {y:String}
      ------test-boundary
      Content-Disposition: form-data; name="param_x"

      42
      ------test-boundary
      Content-Disposition: form-data; name="param_y"

      test
      ------test-boundary--
      "
    `)
  })

  it('should handle empty parts record', () => {
    const result = buildMultipartBody({}, boundary)

    expect(result).toMatchInlineSnapshot(`
      "------test-boundary--
      "
    `)
  })

  it('should return a string', () => {
    const result = buildMultipartBody({ query: 'SELECT 1' }, boundary)
    expect(typeof result).toBe('string')
  })

  it('should reject part names with special characters', () => {
    expect(() => buildMultipartBody({ 'bad name': 'value' }, boundary)).toThrow(
      'Invalid multipart part name: "bad name"',
    )
  })

  it('should reject part names with quotes', () => {
    expect(() =>
      buildMultipartBody({ 'key"injection': 'value' }, boundary),
    ).toThrow('Invalid multipart part name: "key"injection"')
  })

  it('should reject part names with newlines', () => {
    expect(() =>
      buildMultipartBody({ 'key\r\ninjection': 'value' }, boundary),
    ).toThrow(/Invalid multipart part name/)
  })

  it('should accept part names with underscores and digits', () => {
    const result = buildMultipartBody({ param_my_value_123: 'ok' }, boundary)

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_my_value_123"\r\n`,
    )
  })

  it('should accept part names with hyphens and dots', () => {
    const result = buildMultipartBody({ 'param_my-key.name': 'ok' }, boundary)

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_my-key.name"\r\n`,
    )
  })
})
