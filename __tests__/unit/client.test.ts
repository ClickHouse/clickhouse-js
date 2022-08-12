import { validateSelectQuery, createClient } from '../../src/client';

describe('createClient', () => {
  it('throws on incorrect "host" config value', () => {
    expect(() => createClient({ host: 'foo' })).toThrowError(
      'Configuration parameter "host" contains malformed url.'
    );
  });
});

describe('validateSelectQuery', () => {
  it('throws on a query containing FORMAT clause', () => {
    expect(() =>
      validateSelectQuery('select * from table format JSON')
    ).toThrowError(
      'Specifying format is not supported, use "format" parameter instead.'
    );
  });

  it('does not throw on a "format" column name', () => {
    expect(() =>
      validateSelectQuery('select format from my_table')
    ).not.toThrowError();
  });

  it('does not throw on a query without "format" word', () => {
    expect(() =>
      validateSelectQuery('select * from my_format limit 1')
    ).not.toThrowError();
  });
});
