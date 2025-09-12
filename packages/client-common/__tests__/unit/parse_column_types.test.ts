import { parseFixedStringType } from '../../src/parse'

describe('Columns types parser', () => {
  describe('FixedString', () => {
    it('should parse FixedString', async () => {
      const args: [string, number][] = [
        ['FixedString(1)', 1],
        ['FixedString(42)', 42],
        ['FixedString(100)', 100],
        ['FixedString(32768)', 32768],
      ]
      args.forEach(([columnType, sizeBytes]) => {
        const result = parseFixedStringType({
          columnType,
          sourceType: columnType,
        })
        expect(result)
          .withContext(
            `Expected ${columnType} to be parsed as a FixedString with size ${sizeBytes}`,
          )
          .toEqual({ type: 'FixedString', sizeBytes, sourceType: columnType })
      })
    })

    it('should throw on invalid FixedString type', async () => {
      const args: [string][] = [
        ['FixedString'],
        ['FixedString('],
        ['FixedString()'],
        ['String'],
      ]
      args.forEach(([columnType]) => {
        expect(() =>
          parseFixedStringType({ columnType, sourceType: columnType }),
        )
          .withContext(`Expected ${columnType} to throw`)
          .toThrowError('Invalid FixedString type')
      })
    })

    it('should throw on invalid FixedString size', async () => {
      const args: [string][] = [
        ['FixedString(0)'],
        ['FixedString(x)'],
        [`FixedString(')`],
      ]
      args.forEach(([columnType]) => {
        expect(() =>
          parseFixedStringType({ columnType, sourceType: columnType }),
        )
          .withContext(`Expected ${columnType} to throw`)
          .toThrowError('Invalid FixedString size in bytes')
      })
    })
  })
})
