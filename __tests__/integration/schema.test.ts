import { ClickHouseClient } from '../../src';
import {
  createTestClient,
  getClickHouseTestEnvironment,
  guid,
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
          order_by: ['id'],
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
          on_cluster: '{cluster}',
          order_by: ['id'],
          clickhouse_settings: {
            wait_end_of_query: 1,
          },
        });
        break;
      case TestEnv.LocalSingleNode:
        await table.create({
          engine: ch.MergeTree(),
          order_by: ['id'],
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

  it('should insert and select data using arrays', async () => {
    const values = [value1, value2];
    await table.insert({
      values,
    });
    const result = await (
      await table.select({
        clickhouse_settings: {
          output_format_json_quote_64bit_integers: 0,
        },
      })
    ).json();
    expect(result).toEqual(values);
  });

  it('should insert and select data using streams', async () => {
    const values = new InsertStream<Data>();
    values.add(value1);
    values.add(value2);
    setTimeout(() => values.complete(), 100);

    await table.insert({
      values,
    });

    const result: Data[] = [];
    const selectStream = await table.select({
      clickhouse_settings: {
        output_format_json_quote_64bit_integers: 0,
      },
    });

    for await (const value of selectStream.asyncGenerator()) {
      result.push(value);
    }

    expect(result).toEqual([value1, value2]);
  });
});
