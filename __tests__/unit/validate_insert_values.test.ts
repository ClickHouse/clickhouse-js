import Stream from 'stream'
import type { DataFormat } from '../../src'
import { validateInsertValues } from '../../src/client'

describe('validateInsertValues', () => {
  it('should allow object mode stream for JSON* and raw for Tab* or CSV*', async () => {
    const objectModeStream = Stream.Readable.from('foo,bar\n', {
      objectMode: true,
    })
    const rawStream = Stream.Readable.from('foo,bar\n', {
      objectMode: false,
    })

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
    objectFormats.forEach((format) => {
      expect(() =>
        validateInsertValues(objectModeStream, format as DataFormat)
      ).not.toThrow()
      expect(() =>
        validateInsertValues(rawStream, format as DataFormat)
      ).toThrow('with enabled object mode')
    })

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
    rawFormats.forEach((format) => {
      expect(() =>
        validateInsertValues(objectModeStream, format as DataFormat)
      ).toThrow('disabled object mode')
      expect(() =>
        validateInsertValues(rawStream, format as DataFormat)
      ).not.toThrow()
    })
  })
})
