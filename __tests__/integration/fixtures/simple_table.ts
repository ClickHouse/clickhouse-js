import { createTable, TestEnv } from '../../utils'
import type { ClickHouseClient } from '../../../src'

export function createSimpleTable(client: ClickHouseClient, tableName: string) {
  return createTable(client, (env) => {
    switch (env) {
      // ENGINE can be omitted in the cloud statements:
      // it will use ReplicatedMergeTree and will add ON CLUSTER as well
      case TestEnv.Cloud:
        return `
          CREATE TABLE ${tableName}
          (id UInt64, name String, sku Array(UInt8))
          ORDER BY (id)
        `
      case TestEnv.LocalSingleNode:
        return `
          CREATE TABLE ${tableName}
          (id UInt64, name String, sku Array(UInt8))
          ENGINE MergeTree()
          ORDER BY (id)
        `
      case TestEnv.LocalCluster:
        return `
          CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
          (id UInt64, name String, sku Array(UInt8))
          ENGINE ReplicatedMergeTree(
            '/clickhouse/{cluster}/tables/{database}/{table}/{shard}', 
            '{replica}'
          )
          ORDER BY (id)
        `
    }
  })
}
