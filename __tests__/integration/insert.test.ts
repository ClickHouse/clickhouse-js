import { expect } from 'chai';
import type { ResponseJSON } from '../../src';
import { type ClickHouseClient } from '../../src';
import { createTable, createTestClient, guid } from '../utils';
import { TestEnv } from '../utils';

describe('insert', () => {
  let client: ClickHouseClient;
  let tableName: string;
  beforeEach(async () => {
    client = await createTestClient();
    tableName = `insert_test_${guid()}`;
    await createTable(client, (env) => {
      switch (env) {
        // ENGINE can be omitted in the cloud statements:
        // it will use ReplicatedMergeTree and will add ON CLUSTER as well
        case TestEnv.Cloud:
          return `
            CREATE TABLE ${tableName}
            (id UInt64, name String, sku Array(UInt8))
            ORDER BY (id)
          `;
        case TestEnv.LocalSingleNode:
          return `
            CREATE TABLE ${tableName}
            (id UInt64, name String, sku Array(UInt8))
            ENGINE MergeTree()
            ORDER BY (id)
          `;
        case TestEnv.LocalCluster:
          return `
            CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
            (id UInt64, name String, sku Array(UInt8))
            ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
            ORDER BY (id)
          `;
      }
    });
  });
  afterEach(async () => {
    await client.close();
  });

  it('inserts values as an array in a table', async () => {
    const dataToInsert = [
      [42, 'hello', [0, 1]],
      [43, 'world', [3, 4]],
    ];
    await client.insert({
      table: tableName,
      values: dataToInsert,
    });

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: 'hello', sku: [0, 1] },
      { id: '43', name: 'world', sku: [3, 4] },
    ]);
  });

  it('can insert strings with non-latin symbols', async () => {
    const dataToInsert = [
      [42, 'привет', [0, 1]],
      [43, 'мир', [3, 4]],
    ];
    await client.insert({
      table: tableName,
      values: dataToInsert,
    });

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: 'привет', sku: [0, 1] },
      { id: '43', name: 'мир', sku: [3, 4] },
    ]);
  });
});
