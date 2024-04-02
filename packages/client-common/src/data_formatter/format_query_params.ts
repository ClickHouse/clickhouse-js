export function formatQueryParams(
  value: any,
  wrapStringInQuotes = false,
): string {
  if (value === null || value === undefined) return '\\N'
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
    const formatted = value.map((v) => formatQueryParams(v, true))
    return `[${formatted.join(',')}]`
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

  if (typeof value === 'object') {
    const formatted: string[] = []
    for (const [key, val] of Object.entries(value)) {
      formatted.push(
        `${formatQueryParams(key, true)}:${formatQueryParams(val, true)}`,
      )
    }
    return `{${formatted.join(',')}}`
  }

  throw new Error(`Unsupported value in query parameters: [${value}].`)
}

const TabASCII = 9
const NewlineASCII = 10
const CarriageReturnASCII = 13
const SingleQuoteASCII = 39
const BackslashASCII = 92
