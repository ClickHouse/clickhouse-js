import { createClient, type ClickHouseClient } from '../../src';

describe('authentication', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('uses credentials provided during configuration', async () => {
    client = createClient({
      username: 'default',
      password: ''
    });
    await expect(
      client.select({ query: 'SELECT number FROM system.numbers LIMIT 3' })
    ).resolves.not.toThrow();
  });

  it('provides authentication error details', async () => {
    expect.assertions(3);

    const client = createClient({
      username: 'gibberish',
      password: 'gibberish'
    });

    try {
      await client.select({ query: 'SELECT number FROM system.numbers LIMIT 3' });
    } catch(e: any) {
      expect(e.code).toBe('516');
      expect(e.type).toBe('AUTHENTICATION_FAILED');
      expect(e.message).toMatch(/Authentication failed/i);
    }
  });
});
