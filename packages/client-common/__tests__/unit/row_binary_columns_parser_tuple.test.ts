import { parsedEnumTestArgs } from '@test/utils'
import type {
  ParsedColumnDateTime,
  ParsedColumnDateTime64,
  ParsedColumnFixedString,
  ParsedColumnSimple,
  ParsedColumnTuple,
} from '../../src/data_formatter/row_binary/columns_parser'
import { parseTupleType } from '../../src/data_formatter/row_binary/columns_parser'

fdescribe('RowBinary column types parser - Tuple', () => {
  it('should parse Tuple with simple types', async () => {
    const args: TestArgs[] = [
      {
        sourceType: 'Tuple(String, UInt8)',
        expected: {
          type: 'Tuple',
          elements: [
            { type: 'Simple', columnType: 'String', sourceType: 'String' },
            { type: 'Simple', columnType: 'UInt8', sourceType: 'UInt8' },
          ],
          sourceType: 'Tuple(String, UInt8)',
        },
      },
      {
        sourceType: 'Tuple(Int32, Float32)',
        expected: {
          type: 'Tuple',
          elements: [
            { type: 'Simple', columnType: 'Int32', sourceType: 'Int32' },
            { type: 'Simple', columnType: 'Float32', sourceType: 'Float32' },
          ],
          sourceType: 'Tuple(Int32, Float32)',
        },
      },
    ]
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType })
      expect(result)
        .withContext(
          `Expected ${sourceType} to have ${joinElements(expected)} elements`,
        )
        .toEqual(expected)
    })
  })

  it('should parse Tuple with Decimals', async () => {
    const args: TestArgs[] = [
      {
        sourceType: 'Tuple(Decimal(7, 2), Decimal(18, 4))',
        expected: {
          type: 'Tuple',
          elements: [
            {
              type: 'Decimal',
              sourceType: 'Decimal(7, 2)',
              params: { precision: 7, scale: 2, intSize: 32 },
            },
            {
              type: 'Decimal',
              sourceType: 'Decimal(18, 4)',
              params: { precision: 18, scale: 4, intSize: 64 },
            },
          ],
          sourceType: 'Tuple(Decimal(7, 2), Decimal(18, 4))',
        },
      },
    ]
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType })
      expect(result)
        .withContext(
          `Expected ${sourceType} to have ${joinElements(expected)} elements`,
        )
        .toEqual(expected)
    })
  })

  it('should parse Tuple with Enums', async () => {
    const args: TestArgs[] = parsedEnumTestArgs.map((enumElement) => {
      // e.g. Tuple(String, Enum8('a' = 1))
      const sourceType = `Tuple(${stringElement.sourceType}, ${enumElement.sourceType})`
      return {
        sourceType,
        expected: {
          type: 'Tuple',
          elements: [stringElement, enumElement],
          sourceType,
        },
      }
    })
    args.forEach(({ expected, sourceType }) => {
      const result = parseTupleType({ columnType: sourceType, sourceType })
      expect(result)
        .withContext(
          `Expected ${sourceType} to have ${joinElements(expected)} elements`,
        )
        .toEqual(expected)
    })
  })

  it('should parse Tuple with FixedString/DateTime', async () => {
    const fixedStringElement: ParsedColumnFixedString = {
      type: 'FixedString',
      sourceType: 'FixedString(16)',
      sizeBytes: 16,
    }
    const dateTimeElement: ParsedColumnDateTime = {
      type: 'DateTime',
      timezone: null,
      sourceType: 'DateTime',
    }
    const dateTimeWithTimezoneElement: ParsedColumnDateTime = {
      type: 'DateTime',
      timezone: 'Europe/Amsterdam',
      sourceType: `DateTime('Europe/Amsterdam')`,
    }
    const dateTime64Element: ParsedColumnDateTime64 = {
      type: 'DateTime64',
      timezone: null,
      precision: 3,
      sourceType: 'DateTime64(3)',
    }
    const dateTime64WithTimezoneElement: ParsedColumnDateTime64 = {
      type: 'DateTime64',
      timezone: 'Europe/Amsterdam',
      precision: 9,
      sourceType: `DateTime64(9, 'Europe/Amsterdam')`,
    }
    const elements = [
      fixedStringElement,
      dateTimeElement,
      dateTimeWithTimezoneElement,
      dateTime64Element,
      dateTime64WithTimezoneElement,
    ]
    const elementsSourceTypes = elements.map((el) => el.sourceType).join(', ')
    const sourceType = `Tuple(${elementsSourceTypes})`
    const expected: ParsedColumnTuple = {
      type: 'Tuple',
      elements,
      sourceType,
    }
    const result = parseTupleType({ columnType: sourceType, sourceType })
    expect(result).toEqual(expected)
  })

  // TODO: Simple types permutations, Nullable, Arrays, Maps, Nested Tuples

  const stringElement: ParsedColumnSimple = {
    type: 'Simple',
    sourceType: 'String',
    columnType: 'String',
  }
})

function joinElements(expected: ParsedColumnTuple) {
  return expected.elements.map((el) => el.sourceType).join(', ')
}

type TestArgs = {
  sourceType: string
  expected: ParsedColumnTuple
}
