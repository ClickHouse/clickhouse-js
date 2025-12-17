import { describe, it, expect } from 'vitest'
import type { ParsedColumnMap } from '../../src/parse'
import { parseMapType } from '../../src/parse'

describe('Columns types parser - Map', () => {
  it('should parse Map with simple types', async () => {
    const args: [ParsedColumnMap, string][] = [
      [
        {
          type: 'Map',
          key: { type: 'Simple', columnType: 'String', sourceType: 'String' },
          value: { type: 'Simple', columnType: 'UInt8', sourceType: 'UInt8' },
          sourceType: 'Map(String, UInt8)',
        },
        'Map(String, UInt8)',
      ],
      [
        {
          type: 'Map',
          key: { type: 'Simple', columnType: 'Int32', sourceType: 'Int32' },
          value: {
            type: 'Simple',
            columnType: 'Float32',
            sourceType: 'Float32',
          },
          sourceType: 'Map(Int32, Float32)',
        },
        'Map(Int32, Float32)',
      ],
    ]
    args.forEach(([expected, sourceType]) => {
      const result = parseMapType({ columnType: sourceType, sourceType })
      expect(
        result,
        `Expected ${sourceType} to be parsed as a Map with key type ${expected.key.sourceType} and value type ${expected.value.sourceType}`,
      ).toEqual(expected)
    })
  })

  // TODO: rest of the allowed types.
})
