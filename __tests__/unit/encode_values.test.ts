import Stream from 'stream'
import { encodeValues } from '../../src/client'
import type { DataFormat, InputJSON, InputJSONObjectEachRow } from '../../src'

describe('encodeValues', () => {
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

  it('should not do anything for raw formats streams', async () => {
    const values = Stream.Readable.from('foo,bar\n', {
      objectMode: false,
    })
    rawFormats.forEach((format) => {
      // should be exactly the same object (no duplicate instances)
      expect(encodeValues(values, format as DataFormat)).toEqual(values)
    })
  })

  it('should encode JSON streams per line', async () => {
    for (const format of jsonFormats) {
      const values = Stream.Readable.from(['foo', 'bar'], {
        objectMode: true,
      })
      const result = encodeValues(values, format as DataFormat)
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
      const result = encodeValues(values, format as DataFormat)
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
    const result = encodeValues(values, 'JSON')
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
    const result = encodeValues(values, 'JSON')
    let encoded = ''
    for await (const chunk of result) {
      encoded += chunk
    }
    expect(encoded).toEqual(JSON.stringify(values) + '\n')
  })

  it('should fail when we try to encode an unknown type of input', async () => {
    expect(() => encodeValues(1 as any, 'JSON')).toThrow(
      'Cannot encode values of type number with JSON format'
    )
  })
})
