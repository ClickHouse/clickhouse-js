/* eslint @typescript-eslint/no-var-requires: 0 */
import { beforeAll } from 'vitest'
import {
  ClickHouseLogLevel,
  type BaseClickHouseClientConfigOptions,
  type ClickHouseClient,
  type ClickHouseSettings,
} from '@clickhouse/client-common'
import { EnvKeys, getFromEnv } from './env'
import { guid } from './guid'
import {
  getClickHouseTestEnvironment,
  isCloudTestEnv,
  PRINT_DDL,
  SKIP_INIT,
  TestEnv,
} from './test_env'
import { TestLogger } from './test_logger'

let databaseName: string
beforeAll(async () => {
  if (SKIP_INIT) {
    // it will be skipped for unit tests that don't require DB setup
    console.log('\nSkipping test environment initialization')
    return
  }

  console.log(
    `\nTest environment: ${getClickHouseTestEnvironment()}, database: ${
      databaseName ?? 'default'
    }`,
  )
  const initClient = createTestClient({
    request_timeout: 10_000,
  })
  if (isCloudTestEnv() && databaseName === undefined) {
    await wakeUpPing(initClient)
    databaseName = await createRandomDatabase(initClient)
  }
  await initClient.close()
})

export function createTestClient<Stream = unknown>(
  config: BaseClickHouseClientConfigOptions = {},
): ClickHouseClient<Stream> {
  const env = getClickHouseTestEnvironment()
  const clickHouseSettings: ClickHouseSettings = {
    // (U)Int64 are not quoted by default since 25.8
    output_format_json_quote_64bit_integers: 1,
  }
  if (env === TestEnv.LocalCluster) {
    clickHouseSettings.insert_quorum = '2'
  } else if (env === TestEnv.Cloud) {
    clickHouseSettings.select_sequential_consistency = '1'
  }
  // Allow to override `insert_quorum` if necessary
  Object.assign(clickHouseSettings, config?.clickhouse_settings || {})
  const level =
    config.log?.level ??
    (!process.env.LOG_LEVEL || process.env.LOG_LEVEL === 'undefined'
      ? undefined
      : ClickHouseLogLevel[
          process.env.LOG_LEVEL as keyof typeof ClickHouseLogLevel
        ])
  const log: BaseClickHouseClientConfigOptions['log'] = {
    LoggerClass: TestLogger,
    level,
  }

  if (isCloudTestEnv()) {
    return (globalThis as any).environmentSpecificCreateClient({
      url: `https://${getFromEnv(EnvKeys.host)}:8443`,
      password: getFromEnv(EnvKeys.password),
      database: databaseName,
      request_timeout: 60_000,
      log,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }) as ClickHouseClient<Stream>
  } else {
    // The local cluster entrypoint (nginx round-robin LB) is exposed on a different
    // host port than the single-node setup so both can run side by side.
    // See docker-compose.yml for the full port mapping.
    const url =
      env === TestEnv.LocalCluster
        ? 'http://127.0.0.1:8127'
        : 'http://127.0.0.1:8123'
    return (globalThis as any).environmentSpecificCreateClient({
      url,
      database: databaseName,
      log,
      ...config,
      clickhouse_settings: clickHouseSettings,
    }) as ClickHouseClient<Stream>
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

  if (PRINT_DDL) {
    console.info(`\nCreated a table using DDL:\n${ddl}`)
  }
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
    throw new Error('Failed to wake up the service')
  }
}
