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
    return createClient({
      host: process.env['CLICKHOUSE_CLOUD_HOST'] ?? undefined,
      username: process.env['CLICKHOUSE_CLOUD_USERNAME'] ?? undefined,
      password: process.env['CLICKHOUSE_CLOUD_PASSWORD'] ?? undefined,
      ...config,
    });
  } else {
    return createClient(config);
  }
}

export async function createRandomDatabase(
  client: ClickHouseClient,
  useCloud?: boolean
): Promise<string> {
  let databaseId;
  // See https://docs.github.com/en/actions/learn-github-actions/environment-variables#default-environment-variables
  const uuid = randomUUID().replace(/-/g, '');
  let databaseName = 'clickhousejs__';
  if (useCloud === true && isClickHouseCloudEnabled()) {
    databaseId = [
      process.env['GITHUB_RUN_ID'],
      process.env['GITHUB_RUN_NUMBER'],
      process.env['GITHUB_RUN_ATTEMPT'],
      uuid,
    ].join('__');
    databaseName += databaseId;
    console.log(`Using ClickHouse Cloud database ${databaseName}`);
  } else {
    databaseName += uuid;
  }
  await client.command({
    query: `CREATE DATABASE IF NOT EXISTS ${databaseName}`,
  });
  return databaseName;
}

export async function createClientWithRandomDatabase(
  config?: TestClientConfiguration
): Promise<{ client: ClickHouseClient; databaseName: string }> {
  const client = createTestClient(config);
  const databaseName = await createRandomDatabase(client, config?.useCloud);
  return {
    client,
    databaseName,
  };
}

function isClickHouseCloudEnabled() {
  return process.env['CLICKHOUSE_CLOUD_ENABLED'] === 'true';
}
