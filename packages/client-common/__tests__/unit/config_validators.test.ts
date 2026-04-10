import { describe, it, expect } from 'vitest'
import { numberConfigURLValue, enumConfigURLValue } from '../../src/config'
import { ClickHouseLogLevel } from '../../src/logger'

/**
 * Comprehensive unit tests for configuration URL parameter validation
 * Testing edge cases, boundary conditions, and error handling
 */
describe('Configuration URL Value Validators', () => {
  describe('numberConfigURLValue', () => {
    it('should parse valid positive integer', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '42',
      })
      expect(result).toBe(42)
    })

    it('should parse valid negative integer', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '-42',
      })
      expect(result).toBe(-42)
    })

    it('should parse zero', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0',
      })
      expect(result).toBe(0)
    })

    it('should parse valid floating point number', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '3.14',
      })
      expect(result).toBe(3.14)
    })

    it('should trim whitespace', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '  42  ',
      })
      expect(result).toBe(42)
    })

    it('should throw error for NaN', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: 'not_a_number',
        }),
      ).toThrow('"test_param" has invalid numeric value: not_a_number')
    })

    it('should throw error for empty string', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '',
        }),
      ).toThrow('"test_param" has invalid numeric value:')
    })

    it('should throw error for only whitespace', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '   ',
        }),
      ).toThrow('"test_param" has invalid numeric value:')
    })

    it('should enforce minimum value', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '5',
          min: 10,
        }),
      ).toThrow('"test_param" value 5 is less than min allowed 10')
    })

    it('should allow value equal to minimum', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '10',
        min: 10,
      })
      expect(result).toBe(10)
    })

    it('should enforce maximum value', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '150',
          max: 100,
        }),
      ).toThrow('"test_param" value 150 is greater than max allowed 100')
    })

    it('should allow value equal to maximum', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '100',
        max: 100,
      })
      expect(result).toBe(100)
    })

    it('should enforce both min and max', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '50',
        min: 0,
        max: 100,
      })
      expect(result).toBe(50)
    })

    it('should throw when value below min with both constraints', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '-5',
          min: 0,
          max: 100,
        }),
      ).toThrow('"test_param" value -5 is less than min allowed 0')
    })

    it('should throw when value above max with both constraints', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '150',
          min: 0,
          max: 100,
        }),
      ).toThrow('"test_param" value 150 is greater than max allowed 100')
    })

    it('should handle scientific notation', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '1e3',
      })
      expect(result).toBe(1000)
    })

    it('should handle negative scientific notation', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '1e-3',
      })
      expect(result).toBe(0.001)
    })

    it('should throw for Infinity', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: 'Infinity',
        }),
      ).toThrow('"test_param" has invalid numeric value: Infinity')
    })

    it('should throw for -Infinity', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '-Infinity',
        }),
      ).toThrow('"test_param" has invalid numeric value: -Infinity')
    })

    it('should handle very large numbers', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '999999999999',
      })
      expect(result).toBe(999999999999)
    })

    it('should handle very small numbers', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0.000001',
      })
      expect(result).toBe(0.000001)
    })

    it('should throw for number with text prefix', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: 'abc123',
        }),
      ).toThrow('"test_param" has invalid numeric value: abc123')
    })

    it('should throw for number with text suffix', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '123abc',
        }),
      ).toThrow('"test_param" has invalid numeric value: 123abc')
    })

    it('should handle negative zero', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '-0',
      })
      expect(result).toBe(0)
    })

    it('should handle leading plus sign', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '+42',
      })
      expect(result).toBe(42)
    })

    it('should handle leading zeros', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0042',
      })
      expect(result).toBe(42)
    })

    it('should throw for hexadecimal notation', () => {
      // Number() accepts hex, but we should consider if that's desired
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0xFF',
      })
      expect(result).toBe(255) // Number('0xFF') = 255
    })

    it('should throw for octal notation', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0o77',
      })
      expect(result).toBe(63) // Number('0o77') = 63
    })

    it('should throw for binary notation', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0b1010',
      })
      expect(result).toBe(10) // Number('0b1010') = 10
    })

    it('should handle min constraint of 0', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0',
        min: 0,
      })
      expect(result).toBe(0)
    })

    it('should handle max constraint of 0', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0',
        max: 0,
      })
      expect(result).toBe(0)
    })

    it('should throw when negative value with min of 0', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '-1',
          min: 0,
        }),
      ).toThrow('"test_param" value -1 is less than min allowed 0')
    })

    it('should handle floating point with min/max', () => {
      const result = numberConfigURLValue({
        key: 'test_param',
        value: '0.5',
        min: 0,
        max: 1,
      })
      expect(result).toBe(0.5)
    })

    it('should throw for floating point below min', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '0.4',
          min: 0.5,
        }),
      ).toThrow('"test_param" value 0.4 is less than min allowed 0.5')
    })

    it('should throw for comma as decimal separator', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '3,14',
        }),
      ).toThrow('"test_param" has invalid numeric value: 3,14')
    })

    it('should throw for multiple decimal points', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'test_param',
          value: '3.1.4',
        }),
      ).toThrow('"test_param" has invalid numeric value: 3.1.4')
    })
  })

  describe('enumConfigURLValue', () => {
    enum TestEnum {
      VALUE_A = 'a',
      VALUE_B = 'b',
      VALUE_C = 'c',
    }

    enum NumericEnum {
      ZERO = 0,
      ONE = 1,
      TWO = 2,
    }

    it('should parse valid enum value', () => {
      const result = enumConfigURLValue({
        key: 'test_enum',
        value: 'VALUE_A',
        enumObject: TestEnum,
      })
      expect(result).toBe(TestEnum.VALUE_A)
    })

    it('should trim whitespace', () => {
      const result = enumConfigURLValue({
        key: 'test_enum',
        value: '  VALUE_A  ',
        enumObject: TestEnum,
      })
      expect(result).toBe(TestEnum.VALUE_A)
    })

    it('should throw for invalid enum value', () => {
      expect(() =>
        enumConfigURLValue({
          key: 'test_enum',
          value: 'INVALID',
          enumObject: TestEnum,
        }),
      ).toThrow(
        '"test_enum" has invalid value: INVALID. Expected one of: VALUE_A, VALUE_B, VALUE_C.',
      )
    })

    it('should throw for empty string', () => {
      expect(() =>
        enumConfigURLValue({
          key: 'test_enum',
          value: '',
          enumObject: TestEnum,
        }),
      ).toThrow('"test_enum" has invalid value:')
    })

    it('should work with ClickHouseLogLevel enum', () => {
      const result = enumConfigURLValue({
        key: 'log_level',
        value: 'TRACE',
        enumObject: ClickHouseLogLevel,
      })
      expect(result).toBe(ClickHouseLogLevel.TRACE)
    })

    it('should accept all ClickHouseLogLevel values', () => {
      const levels = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'OFF']
      levels.forEach((level) => {
        const result = enumConfigURLValue({
          key: 'log_level',
          value: level,
          enumObject: ClickHouseLogLevel,
        })
        expect(result).toBeDefined()
      })
    })

    it('should throw for invalid log level', () => {
      expect(() =>
        enumConfigURLValue({
          key: 'log_level',
          value: 'VERBOSE',
          enumObject: ClickHouseLogLevel,
        }),
      ).toThrow('"log_level" has invalid value: VERBOSE')
    })

    it('should be case-sensitive', () => {
      expect(() =>
        enumConfigURLValue({
          key: 'test_enum',
          value: 'value_a', // lowercase
          enumObject: TestEnum,
        }),
      ).toThrow('"test_enum" has invalid value: value_a')
    })

    it('should handle numeric enum values', () => {
      const result = enumConfigURLValue({
        key: 'numeric_enum',
        value: 'ZERO',
        enumObject: NumericEnum,
      })
      expect(result).toBe(NumericEnum.ZERO)
    })

    it('should filter out numeric keys from enum', () => {
      // Numeric enums have reverse mappings
      expect(() =>
        enumConfigURLValue({
          key: 'numeric_enum',
          value: '0', // numeric key, not string key
          enumObject: NumericEnum,
        }),
      ).toThrow('"numeric_enum" has invalid value: 0')
    })

    it('should list all valid values in error message', () => {
      try {
        enumConfigURLValue({
          key: 'test_enum',
          value: 'INVALID',
          enumObject: TestEnum,
        })
        expect.fail('Should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('VALUE_A')
        expect(err.message).toContain('VALUE_B')
        expect(err.message).toContain('VALUE_C')
        expect(err.message).toContain('Expected one of:')
      }
    })

    it('should handle single-value enum', () => {
      enum SingleEnum {
        ONLY = 'only',
      }

      const result = enumConfigURLValue({
        key: 'single',
        value: 'ONLY',
        enumObject: SingleEnum,
      })
      expect(result).toBe(SingleEnum.ONLY)
    })

    it('should throw for whitespace-only value', () => {
      expect(() =>
        enumConfigURLValue({
          key: 'test_enum',
          value: '   ',
          enumObject: TestEnum,
        }),
      ).toThrow('"test_enum" has invalid value:')
    })

    it('should handle enum with special characters', () => {
      enum SpecialEnum {
        'VALUE-WITH-DASH' = 'dash',
        'VALUE_WITH_UNDERSCORE' = 'underscore',
      }

      const result = enumConfigURLValue({
        key: 'special',
        value: 'VALUE-WITH-DASH',
        enumObject: SpecialEnum,
      })
      expect(result).toBe(SpecialEnum['VALUE-WITH-DASH'])
    })
  })

  describe('Edge Cases and Integration', () => {
    it('should handle request_timeout min constraint', () => {
      const result = numberConfigURLValue({
        key: 'request_timeout',
        value: '30000',
        min: 0,
      })
      expect(result).toBe(30000)
    })

    it('should throw for negative request_timeout', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'request_timeout',
          value: '-1000',
          min: 0,
        }),
      ).toThrow('"request_timeout" value -1000 is less than min allowed 0')
    })

    it('should handle max_open_connections min constraint', () => {
      const result = numberConfigURLValue({
        key: 'max_open_connections',
        value: '10',
        min: 1,
      })
      expect(result).toBe(10)
    })

    it('should throw for max_open_connections of 0', () => {
      expect(() =>
        numberConfigURLValue({
          key: 'max_open_connections',
          value: '0',
          min: 1,
        }),
      ).toThrow('"max_open_connections" value 0 is less than min allowed 1')
    })

    it('should parse very large timeout values', () => {
      const result = numberConfigURLValue({
        key: 'request_timeout',
        value: '3600000', // 1 hour
        min: 0,
      })
      expect(result).toBe(3600000)
    })

    it('should handle URL parameter parsing workflow', () => {
      // Simulate what happens in transformUrl
      const params = new URLSearchParams({
        request_timeout: '5000',
        max_open_connections: '25',
        log_level: 'DEBUG',
      })

      const timeout = numberConfigURLValue({
        key: 'request_timeout',
        value: params.get('request_timeout')!,
        min: 0,
      })
      const maxConn = numberConfigURLValue({
        key: 'max_open_connections',
        value: params.get('max_open_connections')!,
        min: 1,
      })
      const logLevel = enumConfigURLValue({
        key: 'log_level',
        value: params.get('log_level')!,
        enumObject: ClickHouseLogLevel,
      })

      expect(timeout).toBe(5000)
      expect(maxConn).toBe(25)
      expect(logLevel).toBe(ClickHouseLogLevel.DEBUG)
    })
  })
})
