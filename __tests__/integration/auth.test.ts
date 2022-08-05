import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';

describe('authentication', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('provides authentication error details', (done) => {
    client = createClient({
      username: 'gibberish',
      password: 'gibberish',
    });

    client
      .select({
        query: 'SELECT number FROM system.numbers LIMIT 3',
      })
      .catch((e) => {
        expect(e.code).to.equal('516');
        expect(e.type).to.equal('AUTHENTICATION_FAILED');
        expect(e.message).to.match(/Authentication failed/i);
        done();
      });
  });
});
