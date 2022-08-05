import { expect } from 'chai';
import { transformUrl } from '../../src/connection/adapter/transform_url';

describe('transformUrl', () => {
  it('attaches pathname and search params to the url', () => {
    const url = new URL('http://clickhouse.com');
    const newUrl = transformUrl({
      url,
      pathname: '/foo',
      searchParams: new URLSearchParams({ bar: 'baz' }),
    });
    expect(newUrl.toString()).to.equal('http://clickhouse.com/foo?bar=baz');
  });

  it('attaches pathname without a leading slash', () => {
    const url = new URL('http://clickhouse.com');
    const newUrl = transformUrl({
      url,
      pathname: 'foo',
    });
    expect(newUrl.toString()).to.equal('http://clickhouse.com/foo');
  });

  it('does not mutate an original url', () => {
    const url = new URL('http://clickhouse.com');
    const newUrl = transformUrl({
      url,
      pathname: 'foo',
    });
    expect(newUrl.toString()).to.equal('http://clickhouse.com/foo');
    expect(url.toString()).to.equal('http://clickhouse.com/');
  });

  it('does not mutate an original url search params', () => {
    const url = new URL('http://clickhouse.com?slim=shady');
    const newUrl = transformUrl({
      url,
      searchParams: new URLSearchParams({ bar: 'baz' }),
    });
    expect(newUrl.toString()).to.equal('http://clickhouse.com/?bar=baz');
    expect(url.toString()).to.equal('http://clickhouse.com/?slim=shady');
  });
});
