import { createClient, type ClickHouseClient } from '../../src';
describe('ping', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('makes a ping request', async() => {
    client = createClient();
    const response = await client.ping();
    expect(response).toBe(true);
  });

  it('does not swallow a client error', async() => {
    expect.assertions(1);
    client = createClient({
      host: 'http://localhost:3333'
    });

    try {
      await client.ping();
    } catch (e: any) {
      expect(e.message).toMatch(/connect ECONNREFUSED/);
    }
  });
});
