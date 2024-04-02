import { parseDecimalType } from '../../src/data_formatter/row_binary/columns_parser'

describe('RowBinary column types parser - Decimal', () => {
  type TestArgs = {
    sourceType: string
    precision: number
    scale: number
    intSize: 32 | 64 | 128 | 256
  }

  it('should parse Decimal', async () => {
    const args: TestArgs[] = [
      {
        sourceType: 'Decimal(7, 2)',
        precision: 7,
        scale: 2,
        intSize: 32,
      },
      {
        sourceType: 'Decimal(12, 4)',
        precision: 12,
        scale: 4,
        intSize: 64,
      },
      {
        sourceType: 'Decimal(27, 6)',
        precision: 27,
        scale: 6,
        intSize: 128,
      },
      {
        sourceType: 'Decimal(42, 8)',
        precision: 42,
        scale: 8,
        intSize: 256,
      },
    ]
    args.forEach(({ sourceType, precision, scale, intSize }) => {
      const result = parseDecimalType({ columnType: sourceType, sourceType })
      expect(result)
        .withContext(
          `Expected ${sourceType} to be parsed as a Decimal with precision ${precision}, scale ${scale} and intSize ${intSize}`,
        )
        .toEqual({
          type: 'Decimal',
          params: { precision, scale, intSize },
          sourceType,
        })
    })
  })

  it('should throw on invalid Decimal type', async () => {
    const args: [string][] = [
      ['Decimal'],
      ['Decimal('],
      ['Decimal()'],
      ['Decimal(1)'],
      ['Decimal(1,)'],
      ['Decimal(1, )'],
      ['String'],
    ]
    args.forEach(([columnType]) => {
      expect(() => parseDecimalType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Invalid Decimal type')
    })
  })

  it('should throw on invalid Decimal precision', async () => {
    const args: [string][] = [
      ['Decimal(0, 0)'],
      ['Decimal(x, 0)'],
      [`Decimal(', ')`],
      [`Decimal(77, 1)`], // max is 76
    ]
    args.forEach(([columnType]) => {
      expect(() => parseDecimalType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Invalid Decimal precision')
    })
  })

  it('should throw on invalid Decimal scale', async () => {
    const args: [string][] = [
      ['Decimal(1, 2)'], // scale should be less than precision
      ['Decimal(1, x)'],
      [`Decimal(42, ,)`],
      [`Decimal(42, ')`],
    ]
    args.forEach(([columnType]) => {
      expect(() => parseDecimalType({ columnType, sourceType: columnType }))
        .withContext(`Expected ${columnType} to throw`)
        .toThrowError('Invalid Decimal scale')
    })
  })

  it('should throw when precision or scale cannot be parsed', async () => {
    const columnType = 'Decimal(foobar)'
    expect(() =>
      parseDecimalType({ columnType, sourceType: columnType }),
    ).toThrowError('Expected Decimal type to have both precision and scale')
  })
})
