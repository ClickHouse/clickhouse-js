import { parseEnum } from '../../src/data_formatter/row_binary/columns_parser'

fdescribe('RowBinaryColumnsParser', () => {
  describe('Enum', () => {
    // pass-through; will be used as-is in the result and in the error messages.
    const dbType = 'SomeEnumTypeFromDB'
    it('should parse Enum8', async () => {
      const args: [string, Map<number, string>][] = [
        ["Enum8('a' = 1)", new Map([[1, 'a']])],
        [
          "Enum8('a' = 0, 'b' = 2)",
          new Map([
            [0, 'a'],
            [2, 'b'],
          ]),
        ],
        [
          "Enum8('a' = 1, 'b' = 2, 'c' = 42)",
          new Map([
            [1, 'a'],
            [2, 'b'],
            [42, 'c'],
          ]),
        ],
        [
          "Enum8('f'' = 1, 'x =' = 2, 'b'''' = 3, ''c==' = 42)",
          new Map([
            [1, "f'"],
            [2, 'x ='],
            [3, "b'''"],
            [42, "'c=="],
          ]),
        ],
      ]
      args.forEach(([columnType, values]) => {
        expect(parseEnum({ columnType, dbType }))
          .withContext(
            `Expected ${columnType} to be parsed as Enum8 [${[
              ...values.entries(),
            ]}]`
          )
          .toEqual({
            type: 'Enum',
            intSize: 8,
            dbType,
            values,
          })
      })
    })
    it('should parse Enum16', async () => {
      const args: [string, Map<number, string>][] = [
        ["Enum16('a' = 1)", new Map([[1, 'a']])],
        [
          "Enum16('a' = 0, 'b' = 2)",
          new Map([
            [0, 'a'],
            [2, 'b'],
          ]),
        ],
        [
          "Enum16('a' = 1, 'b' = 2, 'c' = 42)",
          new Map([
            [1, 'a'],
            [2, 'b'],
            [42, 'c'],
          ]),
        ],
        [
          "Enum16('f'' = 1, 'x =' = 2, 'b'''' = 3, ''c==' = 25000)",
          new Map([
            [1, "f'"],
            [2, 'x ='],
            [3, "b'''"],
            [25000, "'c=="],
          ]),
        ],
      ]
      args.forEach(([columnType, values]) => {
        expect(parseEnum({ columnType, dbType }))
          .withContext(
            `Expected ${columnType} to be parsed as Enum16 [${[
              ...values.entries(),
            ]}]`
          )
          .toEqual({
            type: 'Enum',
            intSize: 16,
            dbType,
            values,
          })
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
        expect(() => parseEnum({ columnType, dbType }))
          .withContext(`Expected ${columnType} to throw`)
          .toThrowError('Expected Enum to be either Enum8 or Enum16')
      })
    })
    it('should throw when the values are not valid', async () => {
      const negativeArgs: [string][] = [
        ["Enum8('a' = x)"],
        ["Enum8('foo')"],
      ]
      negativeArgs.forEach(([columnType]) => {
        expect(() => parseEnum({ columnType, dbType }))
          .withContext(`Expected ${columnType} to throw`)
          .toThrowError('Invalid Enum type values')
      })
    })
    it('should throw on duplicate indices', async () => {
      const args: [string][] = [
        ["Enum8('a' = 0, 'b' = 0)"],
        ["Enum8('a' = 0, 'b' = 1, 'c' = 1)"],
      ]
      args.forEach(([columnType]) => {
        expect(() => parseEnum({ columnType, dbType }))
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
        expect(() => parseEnum({ columnType, dbType }))
          .withContext(`Expected ${columnType} to throw`)
          .toThrowError('Duplicate Enum name')
      })
    })
  })
})
