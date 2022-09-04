import { formatQueryParams } from '../../src/data_formatter'

// JS always creates Date object in local timezone,
// so we might need to convert the date to another timezone
function convertDateToTimezone(date: Date, tz: string) {
  return new Date(
    date.toLocaleString('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      fractionalSecondDigits: 3, // print millis
    })
  )
}

describe('formatQueryParams', () => {
  it('formats null', () => {
    expect(formatQueryParams(null)).toBe('NULL')
  })

  it('formats boolean', () => {
    expect(formatQueryParams(true)).toBe('1')
    expect(formatQueryParams(false)).toBe('0')
  })

  it('formats number', () => {
    expect(formatQueryParams(1)).toBe('1')
  })

  it('formats NaN', () => {
    expect(formatQueryParams(NaN)).toBe('nan')
  })

  it('formats Infinity', () => {
    expect(formatQueryParams(Infinity)).toBe('+inf')
    expect(formatQueryParams(+Infinity)).toBe('+inf')
    expect(formatQueryParams(-Infinity)).toBe('-inf')
  })

  it('formats an array', () => {
    expect(formatQueryParams([1, 2, 3])).toBe('[1,2,3]')
  })

  it('formats an empty Array', () => {
    expect(formatQueryParams([])).toBe('[]')
  })

  it('formats a date without timezone', () => {
    const date = convertDateToTimezone(
      new Date(Date.UTC(2022, 6, 29, 7, 52, 14)),
      'UTC'
    )

    expect(formatQueryParams(date)).toBe('2022-07-29 07:52:14')
  })

  it('formats a date with millis', () => {
    expect(
      formatQueryParams(
        convertDateToTimezone(
          new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 123)),
          'UTC'
        )
      )
    ).toBe('2022-07-29 07:52:14.123')
    expect(
      formatQueryParams(
        convertDateToTimezone(
          new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 42)),
          'UTC'
        )
      )
    ).toBe('2022-07-29 07:52:14.042')
    expect(
      formatQueryParams(
        convertDateToTimezone(
          new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 5)),
          'UTC'
        )
      )
    ).toBe('2022-07-29 07:52:14.005')
  })

  it('does not wrap a string in quotes', () => {
    expect(formatQueryParams('hello')).toBe('hello')
  })

  it('escapes special characters in an input string', () => {
    expect(formatQueryParams("hel'lo")).toBe("hel\\'lo")
    expect(formatQueryParams('hel\\lo')).toBe('hel\\\\lo')
  })

  it('wraps strings in an array in quotes', () => {
    expect(formatQueryParams(['1', '2'])).toBe("['1','2']")
  })

  it('formats an object and escapes keys and values', () => {
    expect(
      formatQueryParams({
        ["na'me"]: "cust'om",
      })
    ).toBe("{'na\\'me':'cust\\'om'}")
  })

  it('formats a nested object', () => {
    expect(
      formatQueryParams({
        name: 'custom',
        id: 42,
        params: { refs: [44] },
      })
    ).toBe("{'name':'custom','id':42,'params':{'refs':[44]}}")
  })

  it('throws on unsupported values', () => {
    expect(() => formatQueryParams(undefined)).toThrowError(
      'Unsupported value in query parameters: [undefined].'
    )
    expect(() => formatQueryParams(undefined)).toThrowError(
      'Unsupported value in query parameters: [undefined].'
    )
  })
})
