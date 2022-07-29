import { expect } from 'chai';
import { validateSelectQuery } from '../../src/client';

describe('validateSelectQuery', () => {
  it('throws on a query containing FORMAT clause', () => {
    expect(() =>
      validateSelectQuery('select * from table format JSON')
    ).to.throw(
      'Specifying format is not supported, use "format" parameter instead.'
    );
  });

  it('does not throw on a "format" column name', () => {
    expect(() =>
      validateSelectQuery('select format from my_table')
    ).not.to.throw();
  });

  it('does not throw on a query without "format" word', () => {
    expect(() =>
      validateSelectQuery('select * from my_format limit 1')
    ).not.to.throw();
  });
});
