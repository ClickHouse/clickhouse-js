import type {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
  ClickHouseSettings,
} from '../../src'
import { createClient } from '../../src'
import { guid } from './guid'
import { TestLogger } from './test_logger'
import { getClickHouseTestEnvironment, TestEnv } from './test_env'
import { getFromEnv } from './env'
import { TestDatabaseEnvKey } from '../global.integration'

export function createTestClient(
  config: ClickHouseClientConfigOptions = {}
): ClickHouseClient {
  const env = getClickHouseTestEnvironment()
  const database = process.env[TestDatabaseEnvKey]
  console.log(
    `Using ${env} test environment to create a Client instance for database ${
      database || 'default'
    }`
  )
  const clickHouseSettings: ClickHouseSettings = {}
  if (env === TestEnv.LocalCluster) {
    clickHouseSettings.insert_quorum = '2'
  } else if (env === TestEnv.Cloud) {
    clickHouseSettings.insert_quorum = '3'
    clickHouseSettings.database_replicated_enforce_synchronous_settings = 1
  }
  // Allow to override `insert_quorum` if necessary
  Object.assign(clickHouseSettings, config?.clickhouse_settings || {})
  const logging = {
    log: {
      enable: true,
      LoggerClass: TestLogger,
    },
  }
  if (env === TestEnv.Cloud) {
    return createClient({
      host: `https://${getFromEnv('CLICKHOUSE_CLOUD_HOST')}:8443`,
      password: getFromEnv('CLICKHOUSE_CLOUD_PASSWORD'),
      database,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    })
  } else {
    return createClient({
      database,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    })
  }
}

export async function createRandomDatabase(
  client: ClickHouseClient
): Promise<string> {
  const databaseName = `clickhousejs__${guid()}__${+new Date()}`
  let maybeOnCluster = ''
  if (getClickHouseTestEnvironment() === TestEnv.LocalCluster) {
    maybeOnCluster = `ON CLUSTER '{cluster}'`
  }
  await client.exec({
    query: `CREATE DATABASE IF NOT EXISTS ${databaseName} ${maybeOnCluster}`,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })
  console.log(`Created database ${databaseName}`)
  return databaseName
}

export async function createTable(
  client: ClickHouseClient,
  definition: (environment: TestEnv) => string,
  clickhouse_settings?: ClickHouseSettings
) {
  const env = getClickHouseTestEnvironment()
  const ddl = definition(env)
  await client.exec({
    query: ddl,
    clickhouse_settings: {
      // Force response buffering, so we get the response only when
      // the table is actually created on every node
      // See https://clickhouse.com/docs/en/interfaces/http/#response-buffering
      wait_end_of_query: 1,
      ...(clickhouse_settings || {}),
    },
  })
  console.log(`Created a table using DDL:\n${ddl}`)
}

export function getTestDatabaseName(): string {
  return process.env[TestDatabaseEnvKey] || 'default'
}
