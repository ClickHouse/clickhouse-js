import {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
  ClickHouseSettings,
  createClient,
} from '../../src';
import { guid } from './guid';

export enum TestEnv {
  Cloud = 'CLOUD',
  LocalSingleNode = 'LOCAL_SINGLE_NODE',
  LocalCluster = 'LOCAL_CLUSTER',
}

export function createTestClient(
  config: ClickHouseClientConfigOptions = {}
): ClickHouseClient {
  const env = getClickHouseTestEnvironment();
  const clickHouseSettings: ClickHouseSettings = {};
  if (env === TestEnv.LocalCluster || env === TestEnv.Cloud) {
    clickHouseSettings.insert_quorum = 2;
  }
  if (env === TestEnv.Cloud) {
    console.log('Using ClickHouse Cloud client');
    return createClient({
      host: getFromEnv('CLICKHOUSE_CLOUD_HOST'),
      username: getFromEnv('CLICKHOUSE_CLOUD_USERNAME'),
      password: getFromEnv('CLICKHOUSE_CLOUD_PASSWORD'),
      ...clickHouseSettings,
      ...config,
    });
  } else {
    return createClient({
      ...clickHouseSettings,
      ...config,
    });
  }
}

export async function createRandomDatabase(
  client: ClickHouseClient
): Promise<string> {
  const databaseName = `clickhousejs__${guid()}`;
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${databaseName}`,
  });
  console.log(`Created database ${databaseName}`);
  return databaseName;
}

export async function createTable(
  client: ClickHouseClient,
  definition: (environment: TestEnv) => string
) {
  const env = getClickHouseTestEnvironment();
  const ddl = definition(env);
  await client.command({
    query: ddl,
  });
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
    case 'CLOUD':
      env = TestEnv.Cloud;
      break;
    case 'LOCAL_CLUSTER':
      env = TestEnv.LocalCluster;
      break;
    default:
      env = TestEnv.LocalSingleNode;
      break;
  }
  console.log(`Using ${env} test environment`);
  return env;
}
