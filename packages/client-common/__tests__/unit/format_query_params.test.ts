import { formatQueryParams } from '@clickhouse/client-common'

describe('formatQueryParams', () => {
  it('formats null', () => {
    expect(
      formatQueryParams({
        value: null,
      }),
    ).toBe('\\N')
  })

  it('formats undefined', () => {
    expect(
      formatQueryParams({
        value: undefined,
      }),
    ).toBe('\\N')
  })

  it('formats boolean', () => {
    expect(
      formatQueryParams({
        value: true,
      }),
    ).toBe('1')
    expect(
      formatQueryParams({
        value: false,
      }),
    ).toBe('0')
  })

  it('formats number', () => {
    expect(
      formatQueryParams({
        value: 1,
      }),
    ).toBe('1')
  })

  it('formats NaN', () => {
    expect(
      formatQueryParams({
        value: NaN,
      }),
    ).toBe('nan')
  })

  it('formats Infinity', () => {
    expect(
      formatQueryParams({
        value: Infinity,
      }),
    ).toBe('+inf')
    expect(
      formatQueryParams({
        value: +Infinity,
      }),
    ).toBe('+inf')
    expect(
      formatQueryParams({
        value: -Infinity,
      }),
    ).toBe('-inf')
  })

  it('formats an array', () => {
    expect(formatQueryParams({ value: [1, 2, 3] })).toBe('[1,2,3]')
  })

  it('formats an empty Array', () => {
    expect(formatQueryParams({ value: [] })).toBe('[]')
  })

  it('formats a date without timezone', () => {
    const date = new Date(Date.UTC(2022, 6, 29, 7, 52, 14))

    expect(
      formatQueryParams({
        value: date,
      }),
    ).toBe('1659081134')
  })

  it('formats a date with only nine digits in its Unix timestamp (seconds)', () => {
    const date = new Date(Date.UTC(1973, 10, 29, 21, 33, 9))

    expect(
      formatQueryParams({
        value: date,
      }),
    ).toBe('0123456789')
  })

  it('formats a date with millis', () => {
    expect(
      formatQueryParams({
        value: new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 123)),
      }),
    ).toBe('1659081134.123')
    expect(
      formatQueryParams({
        value: new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 42)),
      }),
    ).toBe('1659081134.042')
    expect(
      formatQueryParams({
        value: new Date(Date.UTC(2022, 6, 29, 7, 52, 14, 5)),
      }),
    ).toBe('1659081134.005')
  })

  it('does not wrap a string in quotes', () => {
    expect(
      formatQueryParams({
        value: 'hello',
      }),
    ).toBe('hello')
  })

  it('escapes special characters in an input string', () => {
    expect(formatQueryParams({ value: "hel'lo" })).toBe("hel\\'lo")
    expect(formatQueryParams({ value: 'hel\\lo' })).toBe('hel\\\\lo')
    expect(formatQueryParams({ value: 'hel\tlo' })).toBe('hel\\tlo')
    expect(formatQueryParams({ value: 'hel\nlo' })).toBe('hel\\nlo')
    expect(formatQueryParams({ value: 'hel\rlo' })).toBe('hel\\rlo')
  })

  it('wraps strings in an array in quotes', () => {
    expect(formatQueryParams({ value: ['1', '2'] })).toBe("['1','2']")
  })

  it('formats an object and escapes keys and values', () => {
    expect(
      formatQueryParams({
        value: {
          ["na'me"]: "cust'om",
        },
      }),
    ).toBe("{'na\\'me':'cust\\'om'}")
    expect(
      formatQueryParams({
        value: {
          ["a'b\nc\td\re\\"]: "\\q'w\ne\tr\rt\\y",
        },
      }),
    ).toBe("{'a\\'b\\nc\\td\\re\\\\':'\\\\q\\'w\\ne\\tr\\rt\\\\y'}")
  })

  it('formats a nested object', () => {
    expect(
      formatQueryParams({
        value: {
          name: 'custom',
          id: 42,
          params: { refs: [44] },
        },
      }),
    ).toBe("{'name':'custom','id':42,'params':{'refs':[44]}}")
  })
})
