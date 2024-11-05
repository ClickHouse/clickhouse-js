import type {
  ParsedColumnDateTime,
  ParsedColumnDateTime64,
  ParsedColumnEnum,
  SimpleColumnType,
} from '../../src/parse'
import { parseArrayType } from '../../src/parse'

describe('Columns types parser - Array', () => {
  it('should parse Array with a simple value type', async () => {
    type TestArgs = {
      columnType: string
      valueType: SimpleColumnType
      dimensions: number
    }
    const args: TestArgs[] = [
      {
        columnType: 'Array(String)',
        valueType: 'String',
        dimensions: 1,
      },
      {
        columnType: 'Array(UInt8)',
        valueType: 'UInt8',
        dimensions: 1,
      },
      {
        columnType: 'Array(Array(Int32))',
        valueType: 'Int32',
        dimensions: 2,
      },
      {
        columnType: 'Array(Array(Array(Date32)))',
        valueType: 'Date32',
        dimensions: 3,
      },
      {
        columnType: 'Array(Array(Array(Array(Float32))))',
        valueType: 'Float32',
        dimensions: 4,
      },
    ]
    args.forEach((args: TestArgs) => {
      const { columnType, valueType, dimensions } = args
      const result = parseArrayType({ columnType, sourceType: columnType })
      expect(result)
        .withContext(
          `Expected ${columnType} to be parsed as an Array with value type ${valueType} and ${dimensions} dimensions`,
        )
        .toEqual({
          type: 'Array',
          value: {
            type: 'Simple',
            columnType: valueType,
            sourceType: valueType, // T
          },
          sourceType: columnType, // Array(T)
          dimensions,
        })
    })
  })

  it('should parse Array with Nullable', async () => {
    type TestArgs = {
      columnType: string
      valueType: SimpleColumnType
      dimensions: number
    }
    const args: TestArgs[] = [
      {
        columnType: 'Array(Nullable(String))',
        valueType: 'String',
        dimensions: 1,
      },
      {
        columnType: 'Array(Array(Nullable(Int32)))',
        valueType: 'Int32',
        dimensions: 2,
      },
    ]
    args.forEach(({ columnType, valueType, dimensions }: TestArgs) => {
      const result = parseArrayType({ columnType, sourceType: columnType })
      expect(result)
        .withContext(
          `Expected ${columnType} to be parsed as an Array with value type ${valueType} and ${dimensions} dimensions`,
        )
        .toEqual({
          type: 'Array',
          value: {
            type: 'Nullable',
            value: {
              type: 'Simple',
              columnType: valueType,
              sourceType: valueType, // T
            },
            sourceType: `Nullable(${valueType})`, // Nullable(T)
          },
          sourceType: columnType, // Array(Nullable(T))
          dimensions,
        })
    })
  })

  it('should parse Array with Enum value type', async () => {
    type TestArgs = {
      value: ParsedColumnEnum
      dimensions: number
      columnType: string
    }
    const sourceEnum8 = `Enum8('foo' = 42)`
    const valuesEnum8 = { 42: 'foo' }
    const sourceEnum16 = `Enum16('bar' = 144, 'qaz' = 500)`
    const valuesEnum16 = {
      144: 'bar',
      500: 'qaz',
    }
    const args: TestArgs[] = [
      {
        value: {
          type: 'Enum',
          intSize: 8,
          values: valuesEnum8,
          sourceType: sourceEnum8,
        },
        dimensions: 1,
        columnType: `Array(${sourceEnum8})`,
      },
      {
        value: {
          type: 'Enum',
          intSize: 16,
          values: valuesEnum16,
          sourceType: sourceEnum16,
        },
        dimensions: 1,
        columnType: `Array(${sourceEnum16})`,
      },
      {
        value: {
          type: 'Enum',
          intSize: 8,
          values: valuesEnum8,
          sourceType: sourceEnum8,
        },
        dimensions: 2,
        columnType: `Array(Array(${sourceEnum8}))`,
      },
      {
        value: {
          type: 'Enum',
          intSize: 16,
          values: valuesEnum16,
          sourceType: sourceEnum16,
        },
        dimensions: 3,
        columnType: `Array(Array(Array(${sourceEnum16})))`,
      },
    ]
    args.forEach(({ columnType, dimensions, value }) => {
      const result = parseArrayType({ columnType, sourceType: columnType })
      expect(result)
        .withContext(
          `Expected ${columnType} to be parsed as an Array with value type ${value.sourceType} and ${dimensions} dimensions`,
        )
        .toEqual({
          type: 'Array',
          sourceType: columnType,
          dimensions,
          value,
        })
    })
  })

  it('should parse Array of DateTime', async () => {
    type TestArgs = {
      value: ParsedColumnDateTime
      dimensions: number
      columnType: string
    }
    const args: TestArgs[] = [
      {
        value: {
          type: 'DateTime',
          timezone: null,
          sourceType: 'DateTime',
        },
        dimensions: 1,
        columnType: 'Array(DateTime)',
      },
      {
        value: {
          type: 'DateTime',
          timezone: 'UTC',
          sourceType: `DateTime('UTC')`,
        },
        dimensions: 1,
        columnType: `Array(DateTime('UTC'))`,
      },
      {
        value: {
          type: 'DateTime',
          timezone: 'Etc/GMT-5',
          sourceType: `DateTime('Etc/GMT-5')`,
        },
        dimensions: 2,
        columnType: `Array(Array(DateTime('Etc/GMT-5')))`,
      },
    ]
    args.forEach(({ columnType, dimensions, value }) => {
      const result = parseArrayType({ columnType, sourceType: columnType })
      expect(result)
        .withContext(
          `Expected ${columnType} to be parsed as an Array with value type ${value.sourceType} and ${dimensions} dimensions`,
        )
        .toEqual({
          type: 'Array',
          sourceType: columnType,
          dimensions,
          value,
        })
    })
  })

  it('should parse Array of DateTime64', async () => {
    type TestArgs = {
      value: ParsedColumnDateTime64
      dimensions: number
      columnType: string
    }
    const args: TestArgs[] = [
      {
        value: {
          type: 'DateTime64',
          timezone: null,
          sourceType: 'DateTime64(0)',
          precision: 0,
        },
        dimensions: 1,
        columnType: 'Array(DateTime64(0))',
      },
      {
        value: {
          type: 'DateTime64',
          timezone: 'UTC',
          sourceType: `DateTime64(3, 'UTC')`,
          precision: 3,
        },
        dimensions: 1,
        columnType: `Array(DateTime64(3, 'UTC'))`,
      },
      {
        value: {
          type: 'DateTime64',
          timezone: 'Etc/GMT-5',
          sourceType: `DateTime64(6, 'Etc/GMT-5')`,
          precision: 6,
        },
        dimensions: 2,
        columnType: `Array(Array(DateTime64(6, 'Etc/GMT-5')))`,
      },
      {
        value: {
          type: 'DateTime64',
          timezone: 'Europe/Sofia',
          sourceType: `DateTime64(9, 'Europe/Sofia')`,
          precision: 9,
        },
        dimensions: 3,
        columnType: `Array(Array(Array(DateTime64(9, 'Europe/Sofia'))))`,
      },
    ]

    args.forEach(({ columnType, dimensions, value }) => {
      const result = parseArrayType({ columnType, sourceType: columnType })
      expect(result)
        .withContext(
          `Expected ${columnType} to be parsed as an Array with value type ${value.sourceType} and ${dimensions} dimensions`,
        )
        .toEqual({
          type: 'Array',
          sourceType: columnType,
          dimensions,
          value,
        })
    })
  })

  // TODO: Map type test.

  it('should throw on invalid Array type', async () => {
    // Array(Int8) is the shortest valid definition
    const args = [
      ['Array'],
      ['Array('],
      ['Array()'],
      ['Array(a'],
      ['Array(ab'],
      ['Array(ab)'],
      ['Array(abc)'],
      ['String'],
    ]
    args.forEach(([columnType]) => {
      expect(() => parseArrayType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Invalid Array type')
    })
  })
})
