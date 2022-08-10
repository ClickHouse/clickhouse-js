import {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
  ClickHouseSettings,
  createClient,
} from '../../src';
import { guid } from './guid';
import { TestLogger } from './test_logger';

export enum TestEnv {
  Cloud = 'cloud',
  LocalSingleNode = 'local_single_node',
  LocalCluster = 'local_cluster',
}

export function createTestClient(
  config: ClickHouseClientConfigOptions = {}
): ClickHouseClient {
  const env = getClickHouseTestEnvironment();
  console.log(`Using ${env} test environment to create a Client instance`);
  const clickHouseSettings: ClickHouseSettings = {};
  if (env === TestEnv.LocalCluster || env === TestEnv.Cloud) {
    clickHouseSettings.insert_quorum = 2;
  }
  // Allow to override `insert_quorum` if necessary
  Object.assign(clickHouseSettings, config?.clickhouse_settings || {});
  const logging = {
    log: {
      enable: true,
      LoggerClass: TestLogger,
    },
  };
  if (env === TestEnv.Cloud) {
    console.log('Using ClickHouse Cloud client');
    return createClient({
      host: getFromEnv('CLICKHOUSE_CLOUD_HOST'),
      username: getFromEnv('CLICKHOUSE_CLOUD_USERNAME'),
      password: getFromEnv('CLICKHOUSE_CLOUD_PASSWORD'),
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    });
  } else {
    return createClient({
      ...logging,
      ...config,
      clickhouse_settings: clickHouseSettings,
    });
  }
}

export async function createRandomDatabase(
  client: ClickHouseClient
): Promise<string> {
  const databaseName = `clickhousejs__${guid()}`;
  await (
    await client.command({
      query: `CREATE DATABASE IF NOT EXISTS ${databaseName}`,
    })
  ).text();
  console.log(`Created database ${databaseName}`);
  return databaseName;
}

export async function createTable(
  client: ClickHouseClient,
  definition: (environment: TestEnv) => string
) {
  const env = getClickHouseTestEnvironment();
  const ddl = definition(env);
  await (
    await client.command({
      query: ddl,
    })
  ).text();
  console.log(`Created a table using DDL:\n${ddl}`);
}

function getFromEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined) {
    throw Error(`Environment variable ${key} is not set`);
  }
  return value;
}

export function getClickHouseTestEnvironment(): TestEnv {
  let env;
  switch (process.env['CLICKHOUSE_TEST_ENVIRONMENT']) {
    case 'cloud':
      env = TestEnv.Cloud;
      break;
    case 'local_cluster':
      env = TestEnv.LocalCluster;
      break;
    default:
      env = TestEnv.LocalSingleNode;
      break;
  }
  return env;
}
