import {
  validateSelectQuery,
  createClient,
  validateInsertValues,
} from '../../src/client'
import Stream from 'stream'
import type { DataFormat } from '../../src'

describe('createClient', () => {
  it('throws on incorrect "host" config value', () => {
    expect(() => createClient({ host: 'foo' })).toThrowError(
      'Configuration parameter "host" contains malformed url.'
    )
  })
})

describe('validateSelectQuery', () => {
  it('throws on a query containing FORMAT clause', () => {
    expect(() =>
      validateSelectQuery('select * from table format JSON')
    ).toThrowError(
      'Specifying format is not supported, use "format" parameter instead.'
    )
  })

  it('does not throw on a "format" column name', () => {
    expect(() =>
      validateSelectQuery('select format from my_table')
    ).not.toThrowError()
  })

  it('does not throw on a query without "format" word', () => {
    expect(() =>
      validateSelectQuery('select * from my_format limit 1')
    ).not.toThrowError()
  })
})

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
