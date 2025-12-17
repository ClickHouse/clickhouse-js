import { describe, it, expect } from 'vitest'
import { enumTypes, parsedEnumTestArgs } from '@test/utils/native_columns'
import { parseEnumType } from '../../src/parse'

describe('Columns types parser - Enum', () => {
  it('should parse correct values', async () => {
    parsedEnumTestArgs.forEach((expected) => {
      const result = parseEnumType({
        sourceType: expected.sourceType,
        columnType: expected.sourceType,
      })
      expect(result)
        .withContext(
          `Expected ${
            expected.sourceType
          } to be parsed as an Enum with intSize ${
            expected.intSize
          } and values ${JSON.stringify(expected.values)}`,
        )
        .toEqual(expected)
    })
  })

  it('should throw when the type is not a valid enum', async () => {
    const args: [string][] = [
      ['Enum'], // should be either 8 or 16
      ['Enum32'],
      ['Enum64'],
      ['String'],
      ['Enum(String)'],
    ]
    args.forEach(([columnType]) => {
      expect(() => parseEnumType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Expected Enum to be either Enum8 or Enum16')
    })
  })

  it('should throw when the values are not valid', async () => {
    const args: [string][] = [["Enum8('a' = x)"], ["Enum16('foo' = 'bar')"]]
    args.forEach(([columnType]) => {
      expect(() => parseEnumType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Expected Enum index to be a valid number')
    })
  })

  it('should throw on duplicate indices', async () => {
    const args: [string][] = [
      ["Enum8('a' = 0, 'b' = 0)"],
      ["Enum8('a' = 0, 'b' = 1, 'c' = 1)"],
    ]
    args.forEach(([columnType]) => {
      expect(() => parseEnumType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Duplicate Enum index')
    })
  })

  it('should throw on duplicate names', async () => {
    const args: [string][] = [
      ["Enum8('a' = 0, 'a' = 1)"],
      ["Enum8('a' = 0, 'b' = 1, 'b' = 2)"],
    ]
    args.forEach(([columnType]) => {
      expect(() => parseEnumType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Duplicate Enum name')
    })
  })

  it('should throw when Enum has no values to parse', async () => {
    // The minimal allowed Enum definition is Enum8('' = 0), i.e. 6 chars inside.
    const allEnumTypeArgs: string[][] = enumTypes.map(([enumType]) => [
      `${enumType}()`,
      `${enumType}(')`,
      `${enumType}('')`,
      `${enumType}('' )`,
      `${enumType}('' =)`,
      `${enumType}('' = )`,
    ])
    allEnumTypeArgs.forEach((args) =>
      args.forEach((columnType) => {
        expect(() => parseEnumType({ columnType, sourceType: columnType }))
          .withContext(`Expected ${columnType} to throw`)
          .toThrowError('Invalid Enum type values')
      }),
    )
  })
})
