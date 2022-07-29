import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';

describe('ping', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('makes a ping request', async () => {
    client = createClient();
    const response = await client.ping();
    expect(response).to.be.true;
  });

  it('does not swallow a client error', (done) => {
    client = createClient({
      host: 'http://localhost:3333',
    });

    client.ping().catch((e) => {
      expect(e.message).to.be.a('string');
      done();
    });
  });
});
