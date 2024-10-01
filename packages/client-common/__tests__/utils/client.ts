/* eslint @typescript-eslint/no-var-requires: 0 */
import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseClient,
  ClickHouseSettings,
} from '@clickhouse/client-common'
import { EnvKeys, getFromEnv } from './env'
import { guid } from './guid'
import {
  getClickHouseTestEnvironment,
  isCloudTestEnv,
  TestEnv,
} from './test_env'
import { TestLogger } from './test_logger'

jasmine.DEFAULT_TIMEOUT_INTERVAL = 400_000

let databaseName: string
beforeAll(async () => {
  console.log(
    `\nTest environment: ${getClickHouseTestEnvironment()}, database: ${
      databaseName ?? 'default'
    }`,
  )
  if (isCloudTestEnv() && databaseName === undefined) {
    const cloudInitClient = createTestClient({
      request_timeout: 10_000,
    })
    await wakeUpPing(cloudInitClient)
    databaseName = await createRandomDatabase(cloudInitClient)
    await cloudInitClient.close()
  }
})

export function createTestClient<Stream = unknown>(
  config: BaseClickHouseClientConfigOptions = {},
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
      url: `https://${getFromEnv(EnvKeys.host)}:8443`,
      password: getFromEnv(EnvKeys.password),
      database: databaseName,
      request_timeout: 60_000,
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }
    if (process.env.browser) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../../../client-web/src/client').createClient(cloudConfig)
    } else {
      // props to https://stackoverflow.com/a/41063795/4575540
      // @ts-expect-error
      return eval('require')('../../../client-node/src/client').createClient(
        cloudConfig,
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
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('../../../client-web/src/client').createClient(localConfig) // eslint-disable-line @typescript-eslint/no-var-requires
    } else {
      // @ts-expect-error
      return eval('require')('../../../client-node/src/client').createClient(
        localConfig,
      ) as ClickHouseClient
    }
  }
}

export async function createRandomDatabase(
  client: ClickHouseClient,
): Promise<string> {
  const databaseName = `clickhousejs__${guid()}__${+new Date()}`
  let maybeOnCluster = ''
  if (getClickHouseTestEnvironment() === TestEnv.LocalCluster) {
    maybeOnCluster = ` ON CLUSTER '{cluster}'`
  }
  const ddl = `CREATE DATABASE IF NOT EXISTS ${databaseName}${maybeOnCluster}`
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
  clickhouse_settings?: ClickHouseSettings,
): Promise<void> {
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

const MaxPingRetries = 30
export async function wakeUpPing(client: ClickHouseClient): Promise<void> {
  let attempts = 1
  let lastError: Error | unknown
  let isAwake = false
  while (attempts <= MaxPingRetries) {
    const result = await client.ping()
    isAwake = result.success
    if (result.success) {
      break
    }
    console.warn(
      `Service is still waking up, ping attempts so far: ${attempts}. Cause:`,
      result.error,
    )
    lastError = result.error
    attempts++
  }
  if (!isAwake) {
    console.error(
      `Failed to wake up the service after ${MaxPingRetries} attempts, exiting. Last error:`,
      lastError,
    )
    await client.close()
    process.exit(1)
  }
}
