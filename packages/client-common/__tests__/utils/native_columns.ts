import type { ParsedColumnEnum } from '../../src/parse'

export const enumTypes: Array<['Enum8' | 'Enum16', 8 | 16]> = [
  ['Enum8', 8],
  ['Enum16', 16],
]

export const parsedEnumTestArgs: Array<ParsedColumnEnum> = enumTypes.flatMap(
  ([enumType, intSize]) => [
    {
      type: 'Enum',
      sourceType: `${enumType}('a' = 1)`,
      values: {
        1: 'a',
      } as Record<number, string>,
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('a' = 0, 'b' = 2)`,
      values: {
        0: 'a',
        2: 'b',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('a' = 1, 'b' = 2, 'c' = 42)`,
      values: {
        1: 'a',
        2: 'b',
        42: 'c',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('f\\'' = 1, 'x =' = 2, 'b\\'\\'\\'' = 3, '\\'c=4=' = 42, '4' = 100)`,
      values: {
        1: "f\\'",
        2: 'x =',
        3: "b\\'\\'\\'",
        42: "\\'c=4=",
        100: '4',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('f\\'()' = 1)`,
      values: {
        1: "f\\'()",
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('\\'' = 0)`,
      values: {
        0: `\\'`,
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('' = 0)`,
      values: {
        0: '',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('' = 42)`,
      values: {
        42: '',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('foo' = 1, '' = 42)`,
      values: {
        1: 'foo',
        42: '',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('' = 0, 'foo' = 42)`,
      values: {
        0: '',
        42: 'foo',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('(' = 1)`,
      values: {
        1: '(',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}(')' = 1)`,
      values: {
        1: ')',
      },
      intSize,
    },
    {
      type: 'Enum',
      sourceType: `${enumType}('()' = 1)`,
      values: {
        1: '()',
      },
      intSize,
    },
  ],
)
