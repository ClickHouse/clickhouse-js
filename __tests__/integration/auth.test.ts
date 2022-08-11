import { expect } from 'chai';
import { type ClickHouseClient } from '../../src';
import { createTestClient } from '../utils';

describe('authentication', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('provides authentication error details', (done) => {
    client = createTestClient({
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
