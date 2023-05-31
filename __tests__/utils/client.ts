import { guid } from './guid'
import { TestLogger } from './test_logger'
import { getClickHouseTestEnvironment, TestEnv } from './test_env'
import { getFromEnv } from './env'
import { TestDatabaseEnvKey } from '../global.integration'
import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseClient,
} from '@clickhouse/client-common/client'
import type { ClickHouseSettings } from '@clickhouse/client-common'
import {
  getTestConnectionType,
  TestConnectionType,
} from './test_connection_type'

export function createTestClient<Stream = unknown>(
  config: BaseClickHouseClientConfigOptions<Stream> = {}
): ClickHouseClient<Stream> {
  const env = getClickHouseTestEnvironment()
  const connectionType = getTestConnectionType()
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
    const cloudConfig: BaseClickHouseClientConfigOptions<Stream> = {
      host: `https://${getFromEnv('CLICKHOUSE_CLOUD_HOST')}:8443`,
      password: getFromEnv('CLICKHOUSE_CLOUD_PASSWORD'),
      database,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (connectionType === TestConnectionType.Node) {
      // @ts-ignore
      return require('@clickhouse/client').createClient(
        cloudConfig
      ) as ClickHouseClient // eslint-disable-line @typescript-eslint/no-var-requires
    } else {
      // @ts-ignore
      return require('@clickhouse/client-browser').createClient(cloudConfig) // eslint-disable-line @typescript-eslint/no-var-requires
    }
  } else {
    const localConfig: BaseClickHouseClientConfigOptions<Stream> = {
      database,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (connectionType === TestConnectionType.Node) {
      // @ts-ignore
      return require('@clickhouse/client').createClient(
        localConfig
      ) as ClickHouseClient // eslint-disable-line @typescript-eslint/no-var-requires
    } else {
      // @ts-ignore
      return require('@clickhouse/client-browser').createClient(localConfig) // eslint-disable-line @typescript-eslint/no-var-requires
    }
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

export async function createTable<Stream = unknown>(
  client: ClickHouseClient<Stream>,
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
