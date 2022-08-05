import { expect } from 'chai';
import { parseError, ClickHouseError } from '../../src/error';

describe('parseError', () => {
  it('parses a single line error', () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).to.be.instanceof(ClickHouseError);
    expect(error.code).to.equal('62');
    expect(error.type).to.equal('SYNTAX_ERROR');
    expect(error.message).to.equal(
      `Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table FORMAT JSON. Expected alias cannot be here. `
    );
  });

  it('parses a multiline error', () => {
    const message = `Code: 62.DB::Exception: Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. (SYNTAX_ERROR) (version 22.7.1.2484 (official build))`;
    const error = parseError(message) as ClickHouseError;

    expect(error).to.be.instanceof(ClickHouseError);
    expect(error.code).to.equal('62');
    expect(error.type).to.equal('SYNTAX_ERROR');
    expect(error.message).to
      .equal(`Syntax error: failed at position 15 ('unknown_table') (line 1, col 15): unknown_table
    FORMAT JSON. Expected alias cannot be here. `);
  });
});
