/* eslint @typescript-eslint/no-var-requires: 0 */
import { guid } from './guid'
import { TestLogger } from './test_logger'
import { getClickHouseTestEnvironment, TestEnv } from './test_env'
import { getFromEnv } from './env'
import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseClient,
} from '@clickhouse/client-common/client'
import type { ClickHouseSettings } from '@clickhouse/client-common'

let databaseName: string
beforeAll(async () => {
  if (
    getClickHouseTestEnvironment() === TestEnv.Cloud &&
    databaseName === undefined
  ) {
    const client = createTestClient()
    databaseName = await createRandomDatabase(client)
    await client.close()
  }
})

export function createTestClient<Stream = unknown>(
  config: BaseClickHouseClientConfigOptions<Stream> = {}
): ClickHouseClient<Stream> {
  const env = getClickHouseTestEnvironment()
  console.log(
    `Using ${env} test environment to create a Client instance for database ${
      databaseName || 'default'
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
      database: databaseName,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (process.env.browser) {
      // @ts-ignore
      return require('@clickhouse/client-browser').createClient(cloudConfig)
    } else {
      // @ts-ignore
      return require('@clickhouse/client').createClient(
        cloudConfig
      ) as ClickHouseClient
    }
  } else {
    const localConfig: BaseClickHouseClientConfigOptions<Stream> = {
      database: databaseName,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (process.env.browser) {
      // @ts-ignore
      return require('@clickhouse/client-browser').createClient(localConfig) // eslint-disable-line @typescript-eslint/no-var-requires
    } else {
      // @ts-ignore
      return require('@clickhouse/client').createClient(
        localConfig
      ) as ClickHouseClient
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
  await client.command({
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
  await client.command({
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
  return databaseName || 'default'
}
