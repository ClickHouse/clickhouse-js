import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';

describe('config', () => {
  before(function () {
    if (process.env.browser) {
      this.skip();
    }
  });

  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('request_timeout sets request timeout', (done) => {
    client = createClient({
      request_timeout: 100,
    });

    client
      .select({
        query: 'SELECT sleep(3)',
      })
      .catch((e: any) => {
        expect(e.message).to.equal('Timeout error');
        done();
      });
  });
});
