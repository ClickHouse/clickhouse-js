import { describe, it, expect } from 'vitest'

import type {
  DataFormat,
  InputJSON,
  InputJSONObjectEachRow,
} from '@clickhouse/client-common'
import Stream from 'stream'
import { NodeValuesEncoder } from '../../src/utils'
import * as simdjson from 'simdjson'

describe('[Node.js] ValuesEncoder', () => {
  const rawFormats = [
    'CSV',
    'CSVWithNames',
    'CSVWithNamesAndTypes',
    'TabSeparated',
    'TabSeparatedRaw',
    'TabSeparatedWithNames',
    'TabSeparatedWithNamesAndTypes',
    'CustomSeparated',
    'CustomSeparatedWithNames',
    'CustomSeparatedWithNamesAndTypes',
  ]
  const objectFormats = [
    'JSON',
    'JSONObjectEachRow',
    'JSONEachRow',
    'JSONStringsEachRow',
    'JSONCompactEachRow',
    'JSONCompactEachRowWithNames',
    'JSONCompactEachRowWithNamesAndTypes',
    'JSONCompactStringsEachRowWithNames',
    'JSONCompactStringsEachRowWithNamesAndTypes',
  ]
  const jsonFormats = [
    'JSON',
    'JSONStrings',
    'JSONCompact',
    'JSONCompactStrings',
    'JSONColumnsWithMetadata',
    'JSONObjectEachRow',
    'JSONEachRow',
    'JSONStringsEachRow',
    'JSONCompactEachRow',
    'JSONCompactEachRowWithNames',
    'JSONCompactEachRowWithNamesAndTypes',
    'JSONCompactStringsEachRowWithNames',
    'JSONCompactStringsEachRowWithNamesAndTypes',
  ]

  const encoder = new NodeValuesEncoder({
    parse: JSON.parse,
    stringify: JSON.stringify,
  })

  describe('[Node.js] validateInsertValues', () => {
    it('should allow object mode stream for JSON* and raw for Tab* or CSV*', async () => {
      const objectModeStream = Stream.Readable.from('foo,bar\n', {
        objectMode: true,
      })
      const rawStream = Stream.Readable.from('foo,bar\n', {
        objectMode: false,
      })

      objectFormats.forEach((format) => {
        expect(() =>
          encoder.validateInsertValues(objectModeStream, format as DataFormat),
        ).not.toThrow()
        expect(() =>
          encoder.validateInsertValues(rawStream, format as DataFormat),
        ).toThrow(
          expect.objectContaining({
            message: expect.stringContaining('with enabled object mode'),
          }),
        )
      })
      rawFormats.forEach((format) => {
        expect(() =>
          encoder.validateInsertValues(objectModeStream, format as DataFormat),
        ).toThrow(
          expect.objectContaining({
            message: expect.stringContaining('with disabled object mode'),
          }),
        )
        expect(() =>
          encoder.validateInsertValues(rawStream, format as DataFormat),
        ).not.toThrow()
      })
    })
  })
  describe('encodeValues', () => {
    it('should not do anything for raw formats streams', async () => {
      const values = Stream.Readable.from('foo,bar\n', {
        objectMode: false,
      })
      rawFormats.forEach((format) => {
        // should be exactly the same object (no duplicate instances)
        expect(encoder.encodeValues(values, format as DataFormat)).toEqual(
          values,
        )
      })
    })

    it('should encode JSON streams per line', async () => {
      for (const format of jsonFormats) {
        const values = Stream.Readable.from(['foo', 'bar'], {
          objectMode: true,
        })
        const result = encoder.encodeValues(values, format as DataFormat)
        let encoded = ''
        for await (const chunk of result) {
          encoded += chunk
        }
        expect(encoded).toEqual('"foo"\n"bar"\n')
      }
    })

    it('should encode JSON arrays', async () => {
      for (const format of jsonFormats) {
        const values = ['foo', 'bar']
        const result = encoder.encodeValues(values, format as DataFormat)
        let encoded = ''
        for await (const chunk of result) {
          encoded += chunk
        }
        expect(encoded).toEqual('"foo"\n"bar"\n')
      }
    })

    it('should encode JSON input (with and without custom JSON handling)', async () => {
      const encoders = [
        encoder,
        new NodeValuesEncoder({
          parse: simdjson.parse,
          stringify: JSON.stringify, // simdjson doesn't have a stringify handler
        }),
      ]

      for (const encoder of encoders) {
        const values: InputJSON = {
          meta: [
            {
              name: 'name',
              type: 'string',
            },
          ],
          data: [{ name: 'foo' }, { name: 'bar' }],
        }
        const result = encoder.encodeValues(values, 'JSON')
        let encoded = ''
        for await (const chunk of result) {
          encoded += chunk
        }
        expect(encoded).toEqual(JSON.stringify(values) + '\n')
      }
    })

    it('should use custom stringify for JSON streams', async () => {
      const customEncoder = new NodeValuesEncoder({
        parse: JSON.parse,
        stringify: (value) => `custom:${JSON.stringify(value)}`,
      })

      const values = Stream.Readable.from([{ name: 'foo' }, { name: 'bar' }], {
        objectMode: true,
      })
      const result = customEncoder.encodeValues(values, 'JSON')
      let encoded = ''
      for await (const chunk of result) {
        encoded += chunk
      }
      expect(encoded).toEqual('custom:{"name":"foo"}\ncustom:{"name":"bar"}\n')
    })

    it('should use custom stringify for JSON arrays', async () => {
      const customEncoder = new NodeValuesEncoder({
        parse: JSON.parse,
        stringify: (value) => `[${JSON.stringify(value)}]`,
      })

      const values = [{ id: 1 }, { id: 2 }]
      const result = customEncoder.encodeValues(values, 'JSONEachRow')
      let encoded = ''
      for await (const chunk of result) {
        encoded += chunk
      }
      expect(encoded).toEqual('[{"id":1}]\n[{"id":2}]\n')
    })

    it('should use custom stringify for InputJSON objects', async () => {
      const customEncoder = new NodeValuesEncoder({
        parse: JSON.parse,
        stringify: (value) => JSON.stringify(value).toUpperCase(),
      })

      const values: InputJSON = {
        meta: [{ name: 'id', type: 'UInt32' }],
        data: [{ id: 1 }],
      }
      const result = customEncoder.encodeValues(values, 'JSON')
      let encoded = ''
      for await (const chunk of result) {
        encoded += chunk
      }
      expect(encoded).toEqual(JSON.stringify(values).toUpperCase() + '\n')
    })

    it('should use custom stringify for JSONObjectEachRow', async () => {
      const customEncoder = new NodeValuesEncoder({
        parse: JSON.parse,
        stringify: (value) => `CUSTOM_${JSON.stringify(value)}`,
      })

      const values: InputJSONObjectEachRow = {
        row1: { name: 'test1' },
        row2: { name: 'test2' },
      }
      const result = customEncoder.encodeValues(values, 'JSONObjectEachRow')
      let encoded = ''
      for await (const chunk of result) {
        encoded += chunk
      }
      expect(encoded).toEqual(`CUSTOM_${JSON.stringify(values)}\n`)
    })

    it('should handle custom stringify with complex objects', async () => {
      const customEncoder = new NodeValuesEncoder({
        parse: JSON.parse,
        stringify: (value) => {
          if (
            typeof value === 'object' &&
            value !== null &&
            'timestamp' in value
          ) {
            return JSON.stringify({
              ...value,
              timestamp: new Date(value.timestamp as string).toISOString(),
            })
          }
          return JSON.stringify(value)
        },
      })

      const values = [
        { id: 1, timestamp: '2024-01-01' },
        { id: 2, timestamp: '2024-01-02' },
      ]
      const result = customEncoder.encodeValues(values, 'JSONEachRow')
      let encoded = ''
      for await (const chunk of result) {
        encoded += chunk
      }
      expect(encoded).toContain('"timestamp":"2024-01-01T00:00:00.000Z"')
      expect(encoded).toContain('"timestamp":"2024-01-02T00:00:00.000Z"')
    })

    it('should use custom stringify across different json formats', async () => {
      const customEncoder = new NodeValuesEncoder({
        parse: JSON.parse,
        stringify: (value) => `>>>${JSON.stringify(value)}<<<`,
      })

      const testFormats = [
        'JSONEachRow',
        'JSONStringsEachRow',
        'JSONCompactEachRow',
      ]

      for (const format of testFormats) {
        const values = [{ test: 'data' }]
        const result = customEncoder.encodeValues(values, format as DataFormat)
        let encoded = ''
        for await (const chunk of result) {
          encoded += chunk
        }
        expect(encoded).toEqual('>>>{"test":"data"}<<<\n')
      }
    })

    it('should encode JSONObjectEachRow input', async () => {
      const values: InputJSONObjectEachRow = {
        a: { name: 'foo' },
        b: { name: 'bar' },
      }
      const result = encoder.encodeValues(values, 'JSON')
      let encoded = ''
      for await (const chunk of result) {
        encoded += chunk
      }
      expect(encoded).toEqual(JSON.stringify(values) + '\n')
    })

    it('should fail when we try to encode an unknown type of input', async () => {
      expect(() => encoder.encodeValues(1 as any, 'JSON')).toThrowError(
        'Cannot encode values of type number with JSON format',
      )
    })
  })
})
