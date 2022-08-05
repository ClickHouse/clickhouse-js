import {
  ClickHouseClient,
  ClickHouseClientConfigOptions,
  createClient,
} from '../../src';
import { randomUUID } from 'crypto';

export type TestClientConfiguration = ClickHouseClientConfigOptions & {
  useCloud?: boolean;
};

export function createTestClient(
  config?: TestClientConfiguration
): ClickHouseClient {
  if (config?.useCloud === true && isClickHouseCloudEnabled()) {
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
  const uuid = randomUUID().replace(/-/g, '');
  const databaseName = `clickhousejs__${uuid}`;
  console.log(`Using database ${databaseName}`);
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${databaseName}`,
  });
  return databaseName;
}

export async function createClientWithRandomDatabase(
  config?: TestClientConfiguration
): Promise<{ client: ClickHouseClient; databaseName: string }> {
  const client = createTestClient(config);
  const databaseName = await createRandomDatabase(client);
  return {
    client,
    databaseName,
  };
}

function isClickHouseCloudEnabled() {
  return process.env['CLICKHOUSE_CLOUD_ENABLED'] === 'true';
}

function getFromEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined) {
    throw Error(`Environment variable ${key} is not set`);
  }
  return value;
}
