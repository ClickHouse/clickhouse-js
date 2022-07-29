import { expect } from 'chai';
import {
  createClient,
  type ClickHouseClient,
  type ClickHouseError,
} from '../../src';

describe('error', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('returns "unknown identifier" error', (done) => {
    client = createClient();
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
    client = createClient();
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
    client = createClient();
    client
      .select({
        query: 'SELECT * FRON unknown_table',
      })
      .catch((e: ClickHouseError) => {
        expect(e.message).to.be.a('string');
        expect(e.message).to.match(/failed at position 15/);
        expect(e.message).to.have.lengthOf.above(0);

        expect(e.code).to.equal('62');
        expect(e.type).to.equal('SYNTAX_ERROR');
        done();
      });
  });
});
