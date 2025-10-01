export class TupleParam {
  constructor(public readonly values: readonly unknown[]) {}
}

export function formatQueryParams({
  value,
  wrapStringInQuotes,
  printNullAsKeyword,
}: FormatQueryParamsOptions): string {
  if (value === null || value === undefined) {
    if (printNullAsKeyword) return 'NULL'
    return '\\N'
  }
  if (Number.isNaN(value)) return 'nan'
  if (value === Number.POSITIVE_INFINITY) return '+inf'
  if (value === Number.NEGATIVE_INFINITY) return '-inf'

  if (typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'string') {
    let result = ''
    for (let i = 0; i < value.length; i++) {
      switch (value.charCodeAt(i)) {
        case TabASCII:
          result += '\\t'
          break
        case NewlineASCII:
          result += '\\n'
          break
        case CarriageReturnASCII:
          result += '\\r'
          break
        case SingleQuoteASCII:
          result += `\\'`
          break
        case BackslashASCII:
          result += '\\\\'
          break
        default:
          result += value[i]
      }
    }
    return wrapStringInQuotes ? `'${result}'` : result
  }

  if (Array.isArray(value)) {
    return `[${value
      .map((v) =>
        formatQueryParams({
          value: v,
          wrapStringInQuotes: true,
          printNullAsKeyword: true,
        }),
      )
      .join(',')}]`
  }

  if (value instanceof Date) {
    // The ClickHouse server parses numbers as time-zone-agnostic Unix timestamps
    const unixTimestamp = Math.floor(value.getTime() / 1000)
      .toString()
      .padStart(10, '0')
    const milliseconds = value.getUTCMilliseconds()
    return milliseconds === 0
      ? unixTimestamp
      : `${unixTimestamp}.${milliseconds.toString().padStart(3, '0')}`
  }

  // (42,'foo',NULL)
  if (value instanceof TupleParam) {
    return `(${value.values
      .map((v) =>
        formatQueryParams({
          value: v,
          wrapStringInQuotes: true,
          printNullAsKeyword: true,
        }),
      )
      .join(',')})`
  }

  if (value instanceof Map) {
    return formatObjectLikeParam(value.entries())
  }

  // This is only useful for simple maps where the keys are strings
  if (typeof value === 'object') {
    return formatObjectLikeParam(Object.entries(value))
  }

  throw new Error(`Unsupported value in query parameters: [${value}].`)
}

// {'key1':'value1',42:'value2'}
function formatObjectLikeParam(
  entries: [unknown, unknown][] | MapIterator<[unknown, unknown]>,
): string {
  const formatted: string[] = []
  for (const [key, val] of entries) {
    formatted.push(
      `${formatQueryParams({
        value: key,
        wrapStringInQuotes: true,
        printNullAsKeyword: true,
      })}:${formatQueryParams({
        value: val,
        wrapStringInQuotes: true,
        printNullAsKeyword: true,
      })}`,
    )
  }
  return `{${formatted.join(',')}}`
}

interface FormatQueryParamsOptions {
  value: unknown
  wrapStringInQuotes?: boolean
  // For tuples/arrays, it is required to print NULL instead of \N
  printNullAsKeyword?: boolean
}

const TabASCII = 9
const NewlineASCII = 10
const CarriageReturnASCII = 13
const SingleQuoteASCII = 39
const BackslashASCII = 92
