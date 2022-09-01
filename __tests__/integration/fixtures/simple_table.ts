import { createTable, TestEnv } from '../../utils'
import type { ClickHouseClient } from '../../../src'
import type { MergeTreeSettings } from '../../../src/settings'

export function createSimpleTable(
  client: ClickHouseClient,
  tableName: string,
  settings: MergeTreeSettings = {}
) {
  return createTable(client, (env) => {
    const filteredSettings = filterSettingsBasedOnEnv(settings, env)
    const _settings = Object.keys(filteredSettings).length
      ? 'SETTINGS ' +
        Object.entries(filteredSettings)
          .map(([key, value]) => {
            const v = typeof value === 'string' ? `'${value}'` : value
            return `${key} = ${v}`
          })
          .join(', ')
      : ''
    switch (env) {
      // ENGINE can be omitted in the cloud statements:
      // it will use ReplicatedMergeTree and will add ON CLUSTER as well
      case TestEnv.Cloud:
        return `
          CREATE TABLE ${tableName}
          (id UInt64, name String, sku Array(UInt8))
          ORDER BY (id) ${_settings}
        `
      case TestEnv.LocalSingleNode:
        return `
          CREATE TABLE ${tableName}
          (id UInt64, name String, sku Array(UInt8))
          ENGINE MergeTree()
          ORDER BY (id) ${_settings}
        `
      case TestEnv.LocalCluster:
        return `
          CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
          (id UInt64, name String, sku Array(UInt8))
          ENGINE ReplicatedMergeTree(
            '/clickhouse/{cluster}/tables/{database}/{table}/{shard}', 
            '{replica}'
          )
          ORDER BY (id) ${_settings}
        `
    }
  })
}

function filterSettingsBasedOnEnv(settings: MergeTreeSettings, env: TestEnv) {
  switch (env) {
    case TestEnv.Cloud:
      // ClickHouse Cloud does not like this particular one
      // Local cluster, however, does.
      if ('non_replicated_deduplication_window' in settings) {
        const filtered = Object.assign({}, settings)
        delete filtered['non_replicated_deduplication_window']
        return filtered
      }
      return settings
    case TestEnv.LocalCluster:
    case TestEnv.LocalSingleNode:
      return settings
  }
}
