import type {
  ParsedColumnDateTime,
  ParsedColumnDateTime64,
  ParsedColumnDecimal,
  ParsedColumnEnum,
  ParsedColumnSimple,
} from '../../src/data_formatter/row_binary/columns_parser'
import { asNullableType } from '../../src/data_formatter/row_binary/columns_parser'

describe('RowBinary column types parser - Nullable', () => {
  it('should wrap a simple type', async () => {
    const args: [ParsedColumnSimple, string][] = [
      [
        { type: 'Simple', columnType: 'String', sourceType: 'String' },
        'Nullable(String)',
      ],
      [
        { type: 'Simple', columnType: 'UInt8', sourceType: 'UInt8' },
        'Nullable(UInt8)',
      ],
      [
        { type: 'Simple', columnType: 'Int32', sourceType: 'Int32' },
        'Nullable(Int32)',
      ],
      [
        { type: 'Simple', columnType: 'Float32', sourceType: 'Float32' },
        'Nullable(Float32)',
      ],
    ]
    args.forEach(([value, sourceType]) => {
      const result = asNullableType(value, sourceType)
      expect(result)
        .withContext(
          `Expected ${value.columnType} to be wrapped as ${sourceType}`
        )
        .toEqual({
          type: 'Nullable',
          sourceType,
          value,
        })
    })
  })

  it('should wrap an Enum', async () => {
    const sourceEnum8 = `Enum8('foo' = 42)`
    const valuesEnum8 = new Map([[42, 'foo']])
    const sourceEnum16 = `Enum16('bar' = 144, 'qaz' = 500)`
    const valuesEnum16 = new Map([
      [144, 'bar'],
      [500, 'qaz'],
    ])
    const args: [ParsedColumnEnum, string][] = [
      [
        {
          type: 'Enum',
          intSize: 8,
          values: valuesEnum8,
          sourceType: sourceEnum8,
        },
        'Nullable(Enum8)',
      ],
      [
        {
          type: 'Enum',
          intSize: 16,
          values: valuesEnum16,
          sourceType: sourceEnum16,
        },
        'Nullable(Enum16)',
      ],
    ]
    args.forEach(([value, sourceType]) => {
      const result = asNullableType(value, sourceType)
      expect(result)
        .withContext(`Expected ${value.type} to be wrapped as ${sourceType}`)
        .toEqual({
          type: 'Nullable',
          sourceType,
          value,
        })
    })
  })

  it('should wrap a Decimal', async () => {
    const args: [ParsedColumnDecimal, string][] = [
      [
        {
          type: 'Decimal',
          params: { intSize: 32, precision: 4, scale: 3 },
          sourceType: 'Decimal(4, 3)',
        },
        'Nullable(Decimal(4, 3))',
      ],
      [
        {
          type: 'Decimal',
          params: { intSize: 64, precision: 12, scale: 6 },
          sourceType: 'Decimal(12, 6)',
        },
        'Nullable(Decimal(12, 6))',
      ],
      [
        {
          type: 'Decimal',
          params: { intSize: 128, precision: 24, scale: 12 },
          sourceType: 'Decimal(24, 12)',
        },
        'Nullable(Decimal(24, 12))',
      ],
      [
        {
          type: 'Decimal',
          params: { intSize: 256, precision: 42, scale: 20 },
          sourceType: 'Decimal(42, 20)',
        },
        'Nullable(Decimal(42, 20))',
      ],
    ]
    args.forEach(([value, sourceType]) => {
      const result = asNullableType(value, sourceType)
      expect(result)
        .withContext(
          `Expected ${value.sourceType} to be wrapped as ${sourceType}`
        )
        .toEqual({
          type: 'Nullable',
          sourceType,
          value,
        })
    })
  })

  it('should wrap a DateTime', async () => {
    const args: [ParsedColumnDateTime, string][] = [
      [
        { type: 'DateTime', timezone: null, sourceType: 'DateTime' },
        'Nullable(DateTime)',
      ],
      [
        { type: 'DateTime', timezone: 'UTC', sourceType: "DateTime('UTC')" },
        `Nullable(DateTime('UTC'))`,
      ],
      [
        { type: 'DateTime', timezone: 'GB', sourceType: "DateTime('GB')" },
        `Nullable(DateTime('GB'))`,
      ],
      [
        {
          type: 'DateTime',
          timezone: 'Etc/GMT-5',
          sourceType: `DateTime('Etc/GMT-5')`,
        },
        `Nullable(DateTime('Etc/GMT-5'))`,
      ],
    ]
    args.forEach(([value, sourceType]) => {
      const result = asNullableType(value, sourceType)
      expect(result)
        .withContext(
          `Expected ${value.sourceType} to be wrapped as ${sourceType}`
        )
        .toEqual({
          type: 'Nullable',
          sourceType,
          value,
        })
    })
  })

  it('should wrap a DateTime64', async () => {
    const args: [ParsedColumnDateTime64, string][] = [
      [
        {
          type: 'DateTime64',
          timezone: null,
          sourceType: 'DateTime64(0)',
          precision: 3,
        },
        'Nullable(DateTime64(0))',
      ],
      [
        {
          type: 'DateTime64',
          timezone: null,
          sourceType: 'DateTime64(3)',
          precision: 3,
        },
        'Nullable(DateTime64(3))',
      ],
      [
        {
          type: 'DateTime64',
          timezone: 'UTC',
          sourceType: `DateTime64(3, 'UTC')`,
          precision: 3,
        },
        `Nullable(DateTime64(3, 'UTC'))`,
      ],
      [
        {
          type: 'DateTime64',
          timezone: 'GB',
          sourceType: `DateTime64(6, 'GB')`,
          precision: 6,
        },
        `Nullable(DateTime64(6, 'GB'))`,
      ],
      [
        {
          type: 'DateTime64',
          timezone: 'Etc/GMT-5',
          sourceType: `DateTime64(9, 'Etc/GMT-5')`,
          precision: 9,
        },
        `Nullable(DateTime64(9, 'Etc/GMT-5'))`,
      ],
    ]
    args.forEach(([value, sourceType]) => {
      const result = asNullableType(value, sourceType)
      expect(result)
        .withContext(
          `Expected ${value.sourceType} to be wrapped as ${sourceType}`
        )
        .toEqual({
          type: 'Nullable',
          sourceType,
          value,
        })
    })
  })

  it('should throw in case of Array or Map', async () => {
    const columnUInt8: ParsedColumnSimple = {
      type: 'Simple',
      columnType: 'UInt8',
      sourceType: 'UInt8',
    }
    const columnString: ParsedColumnSimple = {
      type: 'Simple',
      columnType: 'String',
      sourceType: 'String',
    }
    expect(() =>
      asNullableType(
        {
          type: 'Map',
          key: columnUInt8,
          value: columnString,
          sourceType: 'Map(UInt8, String)',
        },
        '...'
      )
    ).toThrowError('Map cannot be Nullable')
    expect(() =>
      asNullableType(
        {
          type: 'Array',
          value: columnUInt8,
          dimensions: 1,
          sourceType: 'Array(UInt8)',
        },
        '...'
      )
    ).toThrowError('Array cannot be Nullable')
  })
})
