/* eslint @typescript-eslint/no-var-requires: 0 */
import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseClient,
  ClickHouseSettings,
} from '@clickhouse/client-common'
import { getFromEnv } from './env'
import { guid } from './guid'
import {
  getClickHouseTestEnvironment,
  isCloudTestEnv,
  TestEnv,
} from './test_env'
import { TestLogger } from './test_logger'

jasmine.DEFAULT_TIMEOUT_INTERVAL = 120_000

let databaseName: string
beforeAll(async () => {
  console.log(
    `\nTest environment: ${getClickHouseTestEnvironment()}, database: ${
      databaseName ?? 'default'
    }`
  )
  if (isCloudTestEnv() && databaseName === undefined) {
    const client = createTestClient({
      request_timeout: 30_000,
      max_open_connections: 1,
      keep_alive: { enabled: false },
    })
    await wakeUpPing(client)
    databaseName = await createRandomDatabase(client)
    await client.close()
  }
})

export function createTestClient<Stream = unknown>(
  config: BaseClickHouseClientConfigOptions = {}
): ClickHouseClient<Stream> {
  const env = getClickHouseTestEnvironment()
  const clickHouseSettings: ClickHouseSettings = {}
  if (env === TestEnv.LocalCluster) {
    clickHouseSettings.insert_quorum = '2'
  } else if (env === TestEnv.Cloud) {
    clickHouseSettings.insert_quorum = '3'
    clickHouseSettings.database_replicated_enforce_synchronous_settings = 1
  } else if (env === TestEnv.CloudSMT) {
    clickHouseSettings.select_sequential_consistency = '1'
  }
  // Allow to override `insert_quorum` if necessary
  Object.assign(clickHouseSettings, config?.clickhouse_settings || {})
  const logging = {
    log: {
      enable: true,
      LoggerClass: TestLogger,
    },
  }
  if (isCloudTestEnv()) {
    const cloudConfig: BaseClickHouseClientConfigOptions = {
      url: `https://${getFromEnv('CLICKHOUSE_CLOUD_HOST')}:8443`,
      password: getFromEnv('CLICKHOUSE_CLOUD_PASSWORD'),
      database: databaseName,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (process.env.browser) {
      return require('../../../client-web/src/client').createClient(cloudConfig)
    } else {
      // props to https://stackoverflow.com/a/41063795/4575540
      // @ts-expect-error
      return eval('require')('../../../client-node/src/client').createClient(
        cloudConfig
      ) as ClickHouseClient
    }
  } else {
    const localConfig: BaseClickHouseClientConfigOptions = {
      database: databaseName,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (process.env.browser) {
      return require('../../../client-web/src/client').createClient(localConfig) // eslint-disable-line @typescript-eslint/no-var-requires
    } else {
      // @ts-expect-error
      return eval('require')('../../../client-node/src/client').createClient(
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
  const ddl = `CREATE DATABASE IF NOT EXISTS ${databaseName} ${maybeOnCluster}`
  await client.command({
    query: ddl,
    clickhouse_settings: {
      wait_end_of_query: 1,
    },
  })
  console.log(`\nCreated database ${databaseName}`)
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
  console.log(`\nCreated a table using DDL:\n${ddl}`)
}

export function getTestDatabaseName(): string {
  return databaseName || 'default'
}

const MaxPingRetries = 4
export async function wakeUpPing(
  client: ClickHouseClient,
  retries = 0,
  lastError?: Error | unknown
) {
  if (retries < MaxPingRetries) {
    const result = await client.ping()
    if (result.success) {
      return
    }
    if (result.error.message.toLowerCase().includes('timeout')) {
      // maybe the service is still waking up
      console.error(
        `Failed to ping, attempts so far: ${retries + 1}`,
        result.error
      )
      await wakeUpPing(client, retries++, result.error)
    } else {
      throw result.error
    }
  } else {
    console.error(
      `Failed to wake up the service after ${MaxPingRetries} retries, exiting...`,
      lastError
    )
    process.exit(1)
  }
}
