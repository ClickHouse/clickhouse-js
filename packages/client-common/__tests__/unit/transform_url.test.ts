import { describe, it, expect } from 'vitest'
import { transformUrl } from '../../src/index'

describe('transformUrl', () => {
  it('only adds the trailing slash to a url without pathname', () => {
    const url = new URL('http://clickhouse.com')
    const newUrl = transformUrl({
      url,
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/')
  })

  it('does nothing with a url with pathname', () => {
    const url = new URL('http://clickhouse.com/clickhouse')
    const newUrl = transformUrl({
      url,
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/clickhouse')
  })

  it('attaches pathname and search params to the url', () => {
    const url = new URL('http://clickhouse.com')
    const newUrl = transformUrl({
      url,
      pathname: '/foo',
      searchParams: new URLSearchParams({ bar: 'baz' }),
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/foo?bar=baz')
  })

  it('attaches pathname without a leading slash', () => {
    const url = new URL('http://clickhouse.com')
    const newUrl = transformUrl({
      url,
      pathname: 'foo',
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/foo')
  })

  it('attaches pathname to an existing pathname', () => {
    const url = new URL('http://clickhouse.com/clickhouse')
    const newUrl = transformUrl({
      url,
      pathname: '/foobar',
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/clickhouse/foobar')
  })

  it('allows a trailing slash in the pathname', () => {
    const url = new URL('http://clickhouse.com/clickhouse/')
    const newUrl = transformUrl({
      url,
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/clickhouse/')
  })

  it('does not mutate an original url', () => {
    const url = new URL('http://clickhouse.com')
    const newUrl = transformUrl({
      url,
      pathname: 'foo',
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/foo')
    expect(url.toString()).toBe('http://clickhouse.com/')
  })

  it('does not mutate an original url search params', () => {
    const url = new URL('http://clickhouse.com?slim=shady')
    const newUrl = transformUrl({
      url,
      searchParams: new URLSearchParams({ bar: 'baz' }),
    })
    expect(newUrl.toString()).toBe('http://clickhouse.com/?bar=baz')
    expect(url.toString()).toBe('http://clickhouse.com/?slim=shady')
  })
})
