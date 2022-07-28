import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';
import type { ResponseJSON } from '../../src/clickhouse_types';

describe('insert', () => {
  let client: ClickHouseClient;
  beforeEach(async () => {
    client = createClient();
    const ddl = 'CREATE TABLE test_table (id UInt64, name String, sku Array(UInt8)) Engine = Memory';
    await client.command({
      query: ddl
    });
  })
  afterEach(async () => {
    await client.command({ query: 'DROP TABLE test_table' });
    await client.close();
  });

  it('inserts values as an array in a table', async() => {
    const dataToInsert = [
      [42, "hello", [0,1]],
      [43, "world", [3,4]]
    ];
    await client.insert({
      table: 'test_table',
      values: dataToInsert
    });

    const Rows = await client.select({
      query: 'SELECT * FROM test_table',
      format: 'JSONEachRow'
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: "hello", sku: [0, 1] },
      { id: '43', name: "world", sku: [3, 4] },
    ]);
  });

  it('can insert strings with non-latin symbols', async() => {
    const dataToInsert = [
      [42, "привет", [0,1]],
      [43, "мир", [3,4]]
    ];
    await client.insert({
      table: 'test_table',
      values: dataToInsert
    });

    const Rows = await client.select({
      query: 'SELECT * FROM test_table',
      format: 'JSONEachRow'
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: "привет", sku: [0, 1] },
      { id: '43', name: "мир", sku: [3, 4] },
    ]);
  });
});
