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
        expect(e.code).toBe('516');
        expect(e.type).toBe('AUTHENTICATION_FAILED');
        expect(e.message).toMatch(/Authentication failed/i);
        done();
      });
  });
});
