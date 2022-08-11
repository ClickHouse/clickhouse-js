import { expect } from 'chai';
import { type ClickHouseClient, type ResponseJSON } from '../../src';
import { createTable, createTestClient, guid } from '../utils';
import { TestEnv } from '../utils';

describe('insert compression', () => {
  let client: ClickHouseClient;
  let tableName: string;
  beforeEach(async () => {
    client = await createTestClient({
      compression: {
        request: true,
      },
    });
    tableName = `insert_compression_test_${guid()}`;
    await createTable(client, (env) => {
      switch (env) {
        // ENGINE can be omitted in the cloud statements:
        // it will use ReplicatedMergeTree and will add ON CLUSTER as well
        case TestEnv.Cloud:
          return `
            CREATE TABLE ${tableName}
            (id UInt64, sku Array(UInt8))
            ORDER BY (id)
          `;
        case TestEnv.LocalSingleNode:
          return `
            CREATE TABLE ${tableName}
            (id UInt64, sku Array(UInt8))
            ENGINE MergeTree()
            ORDER BY (id)
          `;
        case TestEnv.LocalCluster:
          return `
            CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
            (id UInt64, sku Array(UInt8))
            ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
            ORDER BY (id)
          `;
      }
    });
  });

  afterEach(async () => {
    await client.close();
  });

  it('request compression', async () => {
    const dataToInsert = new Array(1_000).fill(0).map((v, idx) => {
      return [idx, [idx + 1, idx + 2]];
    });

    await client.insert({
      table: tableName,
      values: dataToInsert,
    });

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSON',
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result.data.length).to.equal(1_000);
  });
});
