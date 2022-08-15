import { ClickHouseClient } from '../../src';
import {
  createTestClient,
  getClickHouseTestEnvironment,
  guid,
  retryOnFailure,
  TestEnv,
} from '../utils';

import * as ch from '../../src/schema';
import { Infer, InsertStream } from '../../src/schema';

describe('schema', () => {
  const shape = {
    id: ch.UInt64,
    name: ch.String,
    sku: ch.Array(ch.UInt8),
  };
  let table: ch.Table<typeof shape>;
  const schema = new ch.Schema(shape);

  type Data = Infer<typeof shape>;

  let client: ClickHouseClient;
  let tableName: string;

  beforeEach(async () => {
    client = await createTestClient();
    tableName = `schema_test_${guid()}`;
    table = new ch.Table(client, {
      name: tableName,
      schema,
    });
    const env = getClickHouseTestEnvironment();
    switch (env) {
      case TestEnv.Cloud:
        await table.create({
          engine: ch.MergeTree(),
          orderBy: ['id'],
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        });
        break;
      case TestEnv.LocalCluster:
        await table.create({
          engine: ch.ReplicatedMergeTree({
            zoo_path: '/clickhouse/{cluster}/tables/{database}/{table}/{shard}',
            replica_name: '{replica}',
          }),
          onCluster: '{cluster}',
          orderBy: ['id'],
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        });
        break;
      case TestEnv.LocalSingleNode:
        await table.create({
          engine: ch.MergeTree(),
          orderBy: ['id'],
        });
        break;
    }
    console.log(`Created table ${tableName}`);
  });

  afterEach(async () => {
    await client.close();
  });

  const value1 = {
    id: 42,
    name: 'foo',
    sku: [1, 2],
  };
  const value2 = {
    id: 43,
    name: 'bar',
    sku: [3, 4],
  };
  const compactJson = ({ id, name, sku }: Data) => [id, name, sku];

  it('should insert and select data using arrays', async () => {
    const values = [value1, value2];
    await table.insert({
      values,
      compactJson,
    });
    const result = await (
      await table.select({
        clickhouse_settings: {
          output_format_json_quote_64bit_integers: 0,
        },
      })
    ).asResult();
    expect(result.data).toEqual(values);
  });

  it.skip('should insert and select data using streams', async () => {
    const insertStream = new InsertStream<Data>();

    insertStream.add(value1);
    insertStream.add(value2);
    setTimeout(() => insertStream.complete(), 100);
    // await table.insert({
    //   values: insertStream,
    // });

    const result: Data[] = [];
    const selectStream = await table.select();
    selectStream.onData((data) => {
      result.push(data);
    });

    await retryOnFailure(async () => {
      expect(result).toEqual([value1, value2]);
    });
  });
});
