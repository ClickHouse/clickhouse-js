import { expect } from 'chai';
import { type ClickHouseClient, type ClickHouseError } from '../../src';
import { createTestClient } from '../utils';

describe('error', () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it('returns "unknown identifier" error', (done) => {
    client
      .select({
        query: 'SELECT number FR',
      })
      .catch((e: ClickHouseError) => {
        expect(e.message).to.be.a('string');
        expect(e.message).to.have.lengthOf.above(0);

        expect(e.code).to.equal('47');
        expect(e.type).to.equal('UNKNOWN_IDENTIFIER');
        done();
      });
  });

  it('returns "unknown table" error', (done) => {
    client
      .select({
        query: 'SELECT * FROM unknown_table',
      })
      .catch((e: ClickHouseError) => {
        expect(e.message).to.be.a('string');
        expect(e.message).to.match(/unknown_table doesn't exist/);
        expect(e.message).to.have.lengthOf.above(0);

        expect(e.code).to.equal('60');
        expect(e.type).to.equal('UNKNOWN_TABLE');
        done();
      });
  });

  it('returns "syntax error" error', (done) => {
    client
      .select({
        query: 'SELECT * FRON unknown_table',
      })
      .catch((e: ClickHouseError) => {
        expect(e.message).to.be.a('string');
        expect(e.message).to.match(/failed at position/);
        expect(e.message).to.have.lengthOf.above(0);

        expect(e.code).to.equal('62');
        expect(e.type).to.equal('SYNTAX_ERROR');
        done();
      });
  });

  it('returns "syntax error" error in a multiline query', (done) => {
    client
      .select({
        query: `
        SELECT *
        /* This is:
         a multiline comment
        */
        FRON unknown_table
        `,
      })
      .catch((e: ClickHouseError) => {
        expect(e.message).to.be.a('string');
        expect(e.message).to.match(/failed at position/);
        expect(e.message).to.have.lengthOf.above(0);

        expect(e.code).to.equal('62');
        expect(e.type).to.equal('SYNTAX_ERROR');
        done();
      });
  });
});
