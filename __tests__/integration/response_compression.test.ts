import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';

describe('response compression', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.close();
  });

  it('accepts a compressed response', async () => {
    client = createClient({
      compression: {
        response: true,
      },
    });

    const rows = await client.select({
      query: `
        SELECT number
        FROM system.numbers
        LIMIT 20000
      `,
      format: 'JSONEachRow',
    });

    const response = await rows.json<{ number: string }[]>();
    const last = response[response.length - 1];
    expect(last.number).to.equal('19999');
  });
});
