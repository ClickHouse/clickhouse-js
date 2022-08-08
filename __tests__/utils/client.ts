import {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
  createClient,
} from '../../src';
import { guid } from './guid';

export function createTestClient(
  config?: ClickHouseClientConfigOptions
): ClickHouseClient {
  if (isClickHouseCloudEnabled()) {
    console.log('Using ClickHouse Cloud client');
    return createClient({
      host: getFromEnv('CLICKHOUSE_CLOUD_HOST'),
      username: getFromEnv('CLICKHOUSE_CLOUD_USERNAME'),
      password: getFromEnv('CLICKHOUSE_CLOUD_PASSWORD'),
      ...config,
    });
  } else {
    return createClient(config);
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
  definition: (engine: string) => string,
  engine = 'MergeTree()'
) {
  // By default, no ENGINE statement in the table definition
  // while using Cloud results in Distributed engine and that's what we want
  // https://clickhouse.com/docs/en/engines/table-engines/special/distributed/
  // However, this is not a valid syntax for a local run
  // that's why we set it explicitly while not using Cloud
  // (with ClickHouse as a Docker container instead)
  const ddl = isClickHouseCloudEnabled()
    ? definition('')
    : definition(`ENGINE ${engine}`);
  await client.command({
    query: ddl,
  });
}

function getFromEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined) {
    throw Error(`Environment variable ${key} is not set`);
  }
  return value;
}

function isClickHouseCloudEnabled() {
  return process.env['CLICKHOUSE_CLOUD_ENABLED'] === 'true';
}
