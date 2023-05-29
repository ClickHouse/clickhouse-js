import { getClickHouseTestEnvironment, TestEnv } from './test_env'
import type { NonEmptyArray } from 'client/src/schema'
import * as ch from 'client/src/schema'
import type { ClickHouseClient } from 'client/src'

export async function createTableWithSchema<S extends ch.Shape>(
  client: ClickHouseClient,
  schema: ch.Schema<S>,
  tableName: string,
  orderBy: NonEmptyArray<keyof S>
) {
  const table = new ch.Table(client, {
    name: tableName,
    schema,
  })
  const env = getClickHouseTestEnvironment()
  switch (env) {
    case TestEnv.Cloud:
      await table.create({
        engine: ch.MergeTree(),
        order_by: orderBy,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      })
      break
    case TestEnv.LocalCluster:
      await table.create({
        engine: ch.ReplicatedMergeTree({
          zoo_path: '/clickhouse/{cluster}/tables/{database}/{table}/{shard}',
          replica_name: '{replica}',
        }),
        on_cluster: '{cluster}',
        order_by: orderBy,
        clickhouse_settings: {
          wait_end_of_query: 1,
        },
      })
      break
    case TestEnv.LocalSingleNode:
      await table.create({
        engine: ch.MergeTree(),
        order_by: orderBy,
      })
      break
  }
  console.log(`Created table ${tableName}`)
  return table
}
