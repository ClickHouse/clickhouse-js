import { parseEnumType } from '../../src/data_formatter/row_binary/columns_parser'

fdescribe('RowBinary column types parser - Enum', () => {
  const enumTypes: ['Enum8' | 'Enum16', 8 | 16][] = [
    ['Enum8', 8],
    ['Enum16', 16],
  ]

  it('should parse correct values', async () => {
    type TestArgs = {
      columnType: string
      expectedValues: Map<number, string>
      expectedIntSize: 8 | 16
    }
    const allEnumSizeArgs: TestArgs[][] = enumTypes.map(
      ([enumType, expectedIntSize]) => [
        {
          columnType: `${enumType}('a' = 1)`,
          expectedValues: new Map([[1, 'a']]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('a' = 0, 'b' = 2)`,
          expectedValues: new Map([
            [0, 'a'],
            [2, 'b'],
          ]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('a' = 1, 'b' = 2, 'c' = 42)`,
          expectedValues: new Map([
            [1, 'a'],
            [2, 'b'],
            [42, 'c'],
          ]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('f\\'' = 1, 'x =' = 2, 'b\\'\\'\\'' = 3, '\\'c=4=' = 42, '4' = 100)`,
          expectedValues: new Map([
            [1, "f\\'"],
            [2, 'x ='],
            [3, "b\\'\\'\\'"],
            [42, "\\'c=4="],
            [100, '4'],
          ]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('' = 0)`,
          expectedValues: new Map([[0, '']]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('' = 42)`,
          expectedValues: new Map([[42, '']]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('foo' = 1, '' = 42)`,
          expectedValues: new Map([
            [1, 'foo'],
            [42, ''],
          ]),
          expectedIntSize,
        },
        {
          columnType: `${enumType}('' = 0, 'foo' = 42)`,
          expectedValues: new Map([
            [0, ''],
            [42, 'foo'],
          ]),
          expectedIntSize,
        },
      ]
    )

    allEnumSizeArgs.forEach((args) =>
      args.forEach(({ columnType, expectedValues, expectedIntSize }) => {
        const result = parseEnumType({ columnType, sourceType: columnType })
        expect(result)
          .withContext(
            `Expected ${columnType} to be parsed as an Enum with intSize ${expectedIntSize} and values [${[
              ...expectedValues.entries(),
            ]}]`
          )
          .toEqual({
            type: 'Enum',
            intSize: expectedIntSize,
            values: expectedValues,
            sourceType: columnType,
          })
      })
    )
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
      })
    )
  })
})
