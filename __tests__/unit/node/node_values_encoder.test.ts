import Stream from 'stream'
import type {
  DataFormat,
  InputJSON,
  InputJSONObjectEachRow,
} from '@clickhouse/client-common'
import { NodeValuesEncoder } from '@clickhouse/client/utils'

describe('NodeValuesEncoder', () => {
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

  const encoder = new NodeValuesEncoder()

  describe('Node.js validateInsertValues', () => {
    it('should allow object mode stream for JSON* and raw for Tab* or CSV*', async () => {
      const objectModeStream = Stream.Readable.from('foo,bar\n', {
        objectMode: true,
      })
      const rawStream = Stream.Readable.from('foo,bar\n', {
        objectMode: false,
      })

      objectFormats.forEach((format) => {
        expect(() =>
          encoder.validateInsertValues(objectModeStream, format as DataFormat)
        ).not.toThrow()
        expect(() =>
          encoder.validateInsertValues(rawStream, format as DataFormat)
        ).toThrow(
          jasmine.objectContaining({
            message: jasmine.stringContaining('with enabled object mode'),
          })
        )
      })
      rawFormats.forEach((format) => {
        expect(() =>
          encoder.validateInsertValues(objectModeStream, format as DataFormat)
        ).toThrow(
          jasmine.objectContaining({
            message: jasmine.stringContaining('with disabled object mode'),
          })
        )
        expect(() =>
          encoder.validateInsertValues(rawStream, format as DataFormat)
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
          values
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

    it('should encode JSON input', async () => {
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
        'Cannot encode values of type number with JSON format'
      )
    })
  })
})
