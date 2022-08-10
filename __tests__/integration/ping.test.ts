import { expect } from 'chai';
import { type ClickHouseClient } from '../../src';
import { createTestClient } from '../utils';

describe('ping', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('makes a ping request', async () => {
    client = createTestClient();
    const response = await client.ping();
    expect(response).to.be.true;
  });

  it('does not swallow a client error', (done) => {
    client = createTestClient({
      host: 'http://localhost:3333',
    });

    client.ping().catch((e) => {
      expect(e.message).to.be.a('string');
      done();
    });
  });
});
