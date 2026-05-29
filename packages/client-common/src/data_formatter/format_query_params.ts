export class TupleParam {
  constructor(public readonly values: readonly unknown[]) {}
}

export function formatQueryParams({
  value,
  type,
  wrapStringInQuotes,
  printNullAsKeyword,
}: FormatQueryParamsOptions): string {
  return formatQueryParamsInternal({
    value,
    wrapStringInQuotes,
    printNullAsKeyword,
    isInArrayOrTuple: false,
    truncateDateToSeconds: shouldTruncateDateToSeconds(type),
  })
}

function formatQueryParamsInternal({
  value,
  wrapStringInQuotes,
  printNullAsKeyword,
  isInArrayOrTuple,
  truncateDateToSeconds,
}: FormatQueryParamsOptions & {
  isInArrayOrTuple: boolean
  truncateDateToSeconds: boolean
}): string {
  if (value === null || value === undefined) {
    if (printNullAsKeyword) return 'NULL'
    return '\\N'
  }
  if (Number.isNaN(value)) return 'nan'
  if (value === Number.POSITIVE_INFINITY) return '+inf'
  if (value === Number.NEGATIVE_INFINITY) return '-inf'

  if (typeof value === 'number' || typeof value === 'bigint')
    return String(value)
  if (typeof value === 'boolean') {
    if (isInArrayOrTuple) {
      return value ? 'TRUE' : 'FALSE'
    }
    return value ? '1' : '0'
  }
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
        formatQueryParamsInternal({
          value: v,
          wrapStringInQuotes: true,
          printNullAsKeyword: true,
          isInArrayOrTuple: true,
          truncateDateToSeconds,
        }),
      )
      .join(',')}]`
  }

  if (value instanceof Date) {
    // The ClickHouse server parses numbers as time-zone-agnostic Unix timestamps.
    const unixTimestamp = Math.floor(value.getTime() / 1000)
      .toString()
      .padStart(10, '0')
    const milliseconds = value.getUTCMilliseconds()
    // `DateTime`/`DateTime32` only have second precision and reject fractional
    // timestamps, so the sub-second part is dropped for these parameter types.
    // `DateTime64` keeps the milliseconds (and other types fall back to it too).
    return milliseconds === 0 || truncateDateToSeconds
      ? unixTimestamp
      : `${unixTimestamp}.${milliseconds.toString().padStart(3, '0')}`
  }

  // (42,'foo',NULL)
  if (value instanceof TupleParam) {
    return `(${value.values
      .map((v) =>
        formatQueryParamsInternal({
          value: v,
          wrapStringInQuotes: true,
          printNullAsKeyword: true,
          isInArrayOrTuple: true,
          truncateDateToSeconds,
        }),
      )
      .join(',')})`
  }

  if (value instanceof Map) {
    return formatObjectLikeParam(value.entries(), truncateDateToSeconds)
  }

  // This is only useful for simple maps where the keys are strings
  if (typeof value === 'object') {
    return formatObjectLikeParam(Object.entries(value), truncateDateToSeconds)
  }

  throw new Error(`Unsupported value in query parameters: [${value}].`)
}

// {'key1':'value1',42:'value2'}
function formatObjectLikeParam(
  entries: [unknown, unknown][] | MapIterator<[unknown, unknown]>,
  truncateDateToSeconds: boolean,
): string {
  const formatted: string[] = []
  for (const [key, val] of entries) {
    formatted.push(
      `${formatQueryParamsInternal({
        value: key,
        wrapStringInQuotes: true,
        printNullAsKeyword: true,
        isInArrayOrTuple: true,
        truncateDateToSeconds,
      })}:${formatQueryParamsInternal({
        value: val,
        wrapStringInQuotes: true,
        printNullAsKeyword: true,
        isInArrayOrTuple: true,
        truncateDateToSeconds,
      })}`,
    )
  }
  return `{${formatted.join(',')}}`
}

// `DateTime`/`DateTime32` (with or without a time zone) only support second
// precision and reject fractional Unix timestamps, while `DateTime64` requires
// the fractional part to keep sub-second precision. When the parameter type is
// unknown, the millisecond-precision encoding is kept for backwards compatibility.
function shouldTruncateDateToSeconds(type: string | undefined): boolean {
  if (type === undefined) return false
  return /DateTime/.test(type) && !/DateTime64/.test(type)
}

interface FormatQueryParamsOptions {
  value: unknown
  // The declared ClickHouse type of the parameter (e.g. `DateTime`), if known.
  type?: string
  wrapStringInQuotes?: boolean
  // For tuples/arrays, it is required to print NULL instead of \N
  printNullAsKeyword?: boolean
}

const TabASCII = 9
const NewlineASCII = 10
const CarriageReturnASCII = 13
const SingleQuoteASCII = 39
const BackslashASCII = 92
