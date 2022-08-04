import { expect } from 'chai';
import {
  createClient,
  type ClickHouseClient,
  type ResponseJSON,
} from '../../src';

describe('insert compression', () => {
  let client: ClickHouseClient;

  beforeEach(async () => {
    client = createClient();
    const ddl =
      'CREATE TABLE insert_compression_table (id UInt64, sku Array(UInt8)) Engine = Memory';
    await client.command({
      query: ddl,
    });
  });

  afterEach(async () => {
    await client.command({ query: 'DROP TABLE insert_compression_table' });
    await client.close();
  });

  it('request compression', async () => {
    client = createClient({
      compression: {
        request: true,
      },
    });

    const dataToInsert = new Array(1_000).fill(0).map((v, idx) => {
      return [idx, [idx + 1, idx + 2]];
    });

    await client.insert({
      table: 'insert_compression_table',
      values: dataToInsert,
    });

    const Rows = await client.select({
      query: 'SELECT * FROM insert_compression_table',
      format: 'JSON',
    });

    const result = await Rows.json<ResponseJSON>();

    expect(result.data.length).to.equal(1_000);
  });
});
