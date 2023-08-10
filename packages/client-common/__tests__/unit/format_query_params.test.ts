import { formatQueryParams } from '@clickhouse/client-common'

describe('formatQueryParams', () => {
  it('formats null', () => {
    expect(formatQueryParams(null)).toBe('\\N')
  })

  it('formats undefined', () => {
    expect(formatQueryParams(undefined)).toBe('\\N')
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
    const date = new Date(Date.UTC(2022, 6, 29, 7, 52, 14))

    expect(formatQueryParams(date)).toBe('1659081134000')
  })

  it('formats a date with only nine digits in its Unix timestamp (seconds)', () => {
    const date = new Date(Date.UTC(1973, 10, 29, 21, 33, 9))

    expect(formatQueryParams(date)).toBe('0123456789000')
  })

  it('formats a date with millis', () => {
    expect(
      formatQueryParams(new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 123)))
    ).toBe('1659081134123')
    expect(
      formatQueryParams(new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 42)))
    ).toBe('1659081134042')
    expect(
      formatQueryParams(new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 5)))
    ).toBe('1659081134005')
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
})
