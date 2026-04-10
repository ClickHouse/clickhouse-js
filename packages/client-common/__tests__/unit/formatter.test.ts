import { describe, it, expect } from 'vitest'
import {
  isNotStreamableJSONFamily,
  isStreamableJSONFamily,
  isSupportedRawFormat,
  validateStreamFormat,
  encodeJSON,
  StreamableJSONFormats,
  RecordsJSONFormats,
  SingleDocumentJSONFormats,
  SupportedRawFormats,
  StreamableFormats,
  SupportedJSONFormats,
  type DataFormat,
  type StreamableDataFormat,
  type StreamableJSONDataFormat,
  type SingleDocumentJSONFormat,
  type RecordsJSONFormat,
  type RawDataFormat,
} from '../../src/data_formatter/formatter'

/**
 * Comprehensive unit tests for format validators and encoders
 * Testing all format validation logic and edge cases
 */
describe('Format Validators and Encoders', () => {
  describe('isNotStreamableJSONFamily', () => {
    it('should return true for single document JSON formats', () => {
      const singleDocFormats: SingleDocumentJSONFormat[] = [
        'JSON',
        'JSONStrings',
        'JSONCompact',
        'JSONCompactStrings',
        'JSONColumnsWithMetadata',
      ]

      singleDocFormats.forEach((format) => {
        expect(isNotStreamableJSONFamily(format)).toBe(true)
      })
    })

    it('should return true for records JSON format', () => {
      expect(isNotStreamableJSONFamily('JSONObjectEachRow')).toBe(true)
    })

    it('should return false for streamable JSON formats', () => {
      const streamableFormats: StreamableJSONDataFormat[] = [
        'JSONEachRow',
        'JSONStringsEachRow',
        'JSONCompactEachRow',
        'JSONCompactStringsEachRow',
        'JSONCompactEachRowWithNames',
        'JSONCompactEachRowWithNamesAndTypes',
        'JSONCompactStringsEachRowWithNames',
        'JSONCompactStringsEachRowWithNamesAndTypes',
        'JSONEachRowWithProgress',
      ]

      streamableFormats.forEach((format) => {
        expect(isNotStreamableJSONFamily(format)).toBe(false)
      })
    })

    it('should return false for raw formats', () => {
      const rawFormats: RawDataFormat[] = [
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
        'Parquet',
      ]

      rawFormats.forEach((format) => {
        expect(isNotStreamableJSONFamily(format)).toBe(false)
      })
    })

    it('should return false for unknown formats', () => {
      const unknownFormat = 'UnknownFormat' as DataFormat
      expect(isNotStreamableJSONFamily(unknownFormat)).toBe(false)
    })

    it('should handle all SingleDocumentJSONFormats', () => {
      SingleDocumentJSONFormats.forEach((format) => {
        expect(isNotStreamableJSONFamily(format)).toBe(true)
      })
    })

    it('should handle all RecordsJSONFormats', () => {
      RecordsJSONFormats.forEach((format) => {
        expect(isNotStreamableJSONFamily(format)).toBe(true)
      })
    })
  })

  describe('isStreamableJSONFamily', () => {
    it('should return true for all streamable JSON formats', () => {
      StreamableJSONFormats.forEach((format) => {
        expect(isStreamableJSONFamily(format)).toBe(true)
      })
    })

    it('should return false for single document JSON formats', () => {
      SingleDocumentJSONFormats.forEach((format) => {
        expect(isStreamableJSONFamily(format)).toBe(false)
      })
    })

    it('should return false for records JSON formats', () => {
      RecordsJSONFormats.forEach((format) => {
        expect(isStreamableJSONFamily(format)).toBe(false)
      })
    })

    it('should return false for raw formats', () => {
      SupportedRawFormats.forEach((format) => {
        expect(isStreamableJSONFamily(format)).toBe(false)
      })
    })

    it('should return false for unknown format', () => {
      const unknownFormat = 'UnknownFormat' as DataFormat
      expect(isStreamableJSONFamily(unknownFormat)).toBe(false)
    })

    it('should return true for JSONEachRow', () => {
      expect(isStreamableJSONFamily('JSONEachRow')).toBe(true)
    })

    it('should return true for JSONEachRowWithProgress', () => {
      expect(isStreamableJSONFamily('JSONEachRowWithProgress')).toBe(true)
    })

    it('should return false for JSON (single document)', () => {
      expect(isStreamableJSONFamily('JSON')).toBe(false)
    })
  })

  describe('isSupportedRawFormat', () => {
    it('should return true for all supported raw formats', () => {
      SupportedRawFormats.forEach((format) => {
        expect(isSupportedRawFormat(format)).toBe(true)
      })
    })

    it('should return true for CSV', () => {
      expect(isSupportedRawFormat('CSV')).toBe(true)
    })

    it('should return true for TabSeparated', () => {
      expect(isSupportedRawFormat('TabSeparated')).toBe(true)
    })

    it('should return true for Parquet', () => {
      expect(isSupportedRawFormat('Parquet')).toBe(true)
    })

    it('should return true for CustomSeparated variants', () => {
      expect(isSupportedRawFormat('CustomSeparated')).toBe(true)
      expect(isSupportedRawFormat('CustomSeparatedWithNames')).toBe(true)
      expect(isSupportedRawFormat('CustomSeparatedWithNamesAndTypes')).toBe(
        true,
      )
    })

    it('should return false for JSON formats', () => {
      SupportedJSONFormats.forEach((format) => {
        expect(isSupportedRawFormat(format)).toBe(false)
      })
    })

    it('should return false for unknown format', () => {
      const unknownFormat = 'UnknownFormat' as DataFormat
      expect(isSupportedRawFormat(unknownFormat)).toBe(false)
    })
  })

  describe('validateStreamFormat', () => {
    it('should return true for all streamable formats', () => {
      StreamableFormats.forEach((format) => {
        expect(validateStreamFormat(format)).toBe(true)
      })
    })

    it('should return true for streamable JSON formats', () => {
      StreamableJSONFormats.forEach((format) => {
        expect(validateStreamFormat(format)).toBe(true)
      })
    })

    it('should return true for raw formats', () => {
      SupportedRawFormats.forEach((format) => {
        expect(validateStreamFormat(format)).toBe(true)
      })
    })

    it('should throw error for non-streamable JSON format', () => {
      expect(() => validateStreamFormat('JSON')).toThrow(
        'JSON format is not streamable',
      )
    })

    it('should throw error for JSONObjectEachRow', () => {
      expect(() => validateStreamFormat('JSONObjectEachRow')).toThrow(
        'JSONObjectEachRow format is not streamable',
      )
    })

    it('should throw error for unknown format', () => {
      expect(() => validateStreamFormat('UnknownFormat')).toThrow(
        'UnknownFormat format is not streamable',
      )
    })

    it('should include list of streamable formats in error message', () => {
      try {
        validateStreamFormat('JSON')
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('Streamable formats:')
        expect(err.message).toContain('JSONEachRow')
        expect(err.message).toContain('CSV')
      }
    })

    it('should throw for empty string', () => {
      expect(() => validateStreamFormat('')).toThrow('format is not streamable')
    })

    it('should throw for null', () => {
      expect(() => validateStreamFormat(null)).toThrow()
    })

    it('should throw for undefined', () => {
      expect(() => validateStreamFormat(undefined)).toThrow()
    })

    it('should validate JSONEachRow successfully', () => {
      expect(() => validateStreamFormat('JSONEachRow')).not.toThrow()
      expect(validateStreamFormat('JSONEachRow')).toBe(true)
    })

    it('should validate CSV successfully', () => {
      expect(() => validateStreamFormat('CSV')).not.toThrow()
      expect(validateStreamFormat('CSV')).toBe(true)
    })

    it('should validate Parquet successfully', () => {
      expect(() => validateStreamFormat('Parquet')).not.toThrow()
      expect(validateStreamFormat('Parquet')).toBe(true)
    })

    it('should be case-sensitive', () => {
      expect(() => validateStreamFormat('jsoneachrow')).toThrow()
      expect(() => validateStreamFormat('JSONEACHROW')).toThrow()
      expect(() => validateStreamFormat('csv')).toThrow()
    })
  })

  describe('encodeJSON', () => {
    const mockStringify = (value: any) => JSON.stringify(value)

    it('should encode object with JSONEachRow format', () => {
      const data = { id: 1, name: 'test' }
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should add newline after JSON encoding', () => {
      const data = { value: 42 }
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result.endsWith('\n')).toBe(true)
    })

    it('should work with all supported JSON formats', () => {
      const data = { test: 'value' }
      SupportedJSONFormats.forEach((format) => {
        const result = encodeJSON(data, format, mockStringify)
        expect(result).toBe(JSON.stringify(data) + '\n')
      })
    })

    it('should encode array', () => {
      const data = [1, 2, 3]
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should encode string', () => {
      const data = 'test string'
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should encode number', () => {
      const data = 42
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should encode null', () => {
      const data = null
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe('null\n')
    })

    it('should encode boolean', () => {
      const data = true
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe('true\n')
    })

    it('should throw error for non-JSON format', () => {
      const data = { test: 'value' }
      expect(() => encodeJSON(data, 'CSV', mockStringify)).toThrow(
        'The client does not support JSON encoding in [CSV] format',
      )
    })

    it('should throw error for TabSeparated format', () => {
      const data = { test: 'value' }
      expect(() => encodeJSON(data, 'TabSeparated', mockStringify)).toThrow(
        'The client does not support JSON encoding in [TabSeparated] format',
      )
    })

    it('should throw error for unknown format', () => {
      const data = { test: 'value' }
      expect(() =>
        encodeJSON(data, 'UnknownFormat' as DataFormat, mockStringify),
      ).toThrow('The client does not support JSON encoding in [UnknownFormat]')
    })

    it('should use custom stringify function', () => {
      const customStringify = (value: any) => `CUSTOM:${JSON.stringify(value)}`
      const data = { test: 'value' }
      const result = encodeJSON(data, 'JSONEachRow', customStringify)
      expect(result).toBe(`CUSTOM:${JSON.stringify(data)}\n`)
    })

    it('should handle nested objects', () => {
      const data = {
        user: {
          id: 1,
          profile: {
            name: 'John',
            tags: ['a', 'b', 'c'],
          },
        },
      }
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should handle special characters in strings', () => {
      const data = { message: 'Line 1\nLine 2\tTabbed\r\nWindows' }
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should handle Unicode characters', () => {
      const data = { text: '你好世界 🌍' }
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should work with JSONCompactEachRow', () => {
      const data = { a: 1, b: 2 }
      const result = encodeJSON(data, 'JSONCompactEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should work with JSONStringsEachRow', () => {
      const data = { a: '1', b: '2' }
      const result = encodeJSON(data, 'JSONStringsEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should work with single document formats', () => {
      const data = { rows: 100 }
      SingleDocumentJSONFormats.forEach((format) => {
        const result = encodeJSON(data, format, mockStringify)
        expect(result).toBe(JSON.stringify(data) + '\n')
      })
    })

    it('should work with records format', () => {
      const data = { row1: { id: 1 }, row2: { id: 2 } }
      const result = encodeJSON(data, 'JSONObjectEachRow', mockStringify)
      expect(result).toBe(JSON.stringify(data) + '\n')
    })

    it('should handle empty object', () => {
      const data = {}
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe('{}\n')
    })

    it('should handle empty array', () => {
      const data: any[] = []
      const result = encodeJSON(data, 'JSONEachRow', mockStringify)
      expect(result).toBe('[]\n')
    })

    it('should throw for Parquet format', () => {
      const data = { test: 'value' }
      expect(() => encodeJSON(data, 'Parquet', mockStringify)).toThrow()
    })
  })

  describe('Format Constants', () => {
    it('should have correct StreamableJSONFormats', () => {
      expect(StreamableJSONFormats).toContain('JSONEachRow')
      expect(StreamableJSONFormats).toContain('JSONStringsEachRow')
      expect(StreamableJSONFormats).toContain('JSONCompactEachRow')
      expect(StreamableJSONFormats).toContain('JSONEachRowWithProgress')
      expect(StreamableJSONFormats).toHaveLength(9)
    })

    it('should have correct RecordsJSONFormats', () => {
      expect(RecordsJSONFormats).toContain('JSONObjectEachRow')
      expect(RecordsJSONFormats).toHaveLength(1)
    })

    it('should have correct SingleDocumentJSONFormats', () => {
      expect(SingleDocumentJSONFormats).toContain('JSON')
      expect(SingleDocumentJSONFormats).toContain('JSONStrings')
      expect(SingleDocumentJSONFormats).toContain('JSONCompact')
      expect(SingleDocumentJSONFormats).toContain('JSONCompactStrings')
      expect(SingleDocumentJSONFormats).toContain('JSONColumnsWithMetadata')
      expect(SingleDocumentJSONFormats).toHaveLength(5)
    })

    it('should have correct SupportedRawFormats', () => {
      expect(SupportedRawFormats).toContain('CSV')
      expect(SupportedRawFormats).toContain('TabSeparated')
      expect(SupportedRawFormats).toContain('Parquet')
      expect(SupportedRawFormats).toHaveLength(11)
    })

    it('should have no duplicate formats in SupportedJSONFormats', () => {
      const uniqueFormats = new Set(SupportedJSONFormats)
      expect(uniqueFormats.size).toBe(SupportedJSONFormats.length)
    })

    it('should have no duplicate formats in StreamableFormats', () => {
      const uniqueFormats = new Set(StreamableFormats)
      expect(uniqueFormats.size).toBe(StreamableFormats.length)
    })

    it('StreamableFormats should include all streamable JSON and raw formats', () => {
      StreamableJSONFormats.forEach((format) => {
        expect(StreamableFormats).toContain(format)
      })
      SupportedRawFormats.forEach((format) => {
        expect(StreamableFormats).toContain(format)
      })
    })

    it('SupportedJSONFormats should include all JSON format types', () => {
      StreamableJSONFormats.forEach((format) => {
        expect(SupportedJSONFormats).toContain(format)
      })
      SingleDocumentJSONFormats.forEach((format) => {
        expect(SupportedJSONFormats).toContain(format)
      })
      RecordsJSONFormats.forEach((format) => {
        expect(SupportedJSONFormats).toContain(format)
      })
    })
  })

  describe('Format Classification Edge Cases', () => {
    it('should not classify raw formats as JSON', () => {
      SupportedRawFormats.forEach((format) => {
        expect(isStreamableJSONFamily(format)).toBe(false)
        expect(isNotStreamableJSONFamily(format)).toBe(false)
      })
    })

    it('every JSON format should be in exactly one JSON category', () => {
      SupportedJSONFormats.forEach((format) => {
        const isStreamable = isStreamableJSONFamily(format)
        const isNotStreamable = isNotStreamableJSONFamily(format)
        // Must be in exactly one category
        expect(isStreamable !== isNotStreamable).toBe(true)
      })
    })

    it('streamable formats should either be JSON or raw', () => {
      StreamableFormats.forEach((format) => {
        const isJSON = isStreamableJSONFamily(format)
        const isRaw = isSupportedRawFormat(format)
        // Must be in exactly one category
        expect(isJSON !== isRaw).toBe(true)
      })
    })
  })
})
