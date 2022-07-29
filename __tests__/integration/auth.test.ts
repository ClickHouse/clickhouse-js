import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';

describe('authentication', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('provides authentication error details', async () => {
    client = createClient({
      username: 'gibberish',
      password: 'gibberish',
    });

    try {
      await client.select({
        query: 'SELECT number FROM system.numbers LIMIT 3',
      });
      throw new Error('Did not throw');
    } catch (e: any) {
      expect(e.code).to.equal('516');
      expect(e.type).to.equal('AUTHENTICATION_FAILED');
      expect(e.message).to.match(/Authentication failed/i);
    }
  });
});
