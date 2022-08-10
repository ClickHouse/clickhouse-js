import { expect } from 'chai';
import type { CommandParams, ResponseJSON } from '../../src';
import { type ClickHouseClient } from '../../src';
import {
  createTestClient,
  getClickHouseTestEnvironment,
  TestEnv,
} from '../utils';
import { guid } from '../utils';

describe('command', () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it('sends a command to execute', async () => {
    const { ddl, tableName, engine } = getDDL();

    await runCommand(client, {
      query: ddl,
      format: 'TabSeparated',
    });

    const selectResult = await client.select({
      query: `SELECT * from system.tables where name = '${tableName}'`,
      format: 'JSON',
    });

    const { data, rows } = await selectResult.json<
      ResponseJSON<{ name: string; engine: string; create_table_query: string }>
    >();

    expect(rows).to.equal(1);
    const table = data[0];
    expect(table.name).equal(tableName);
    expect(table.engine).equal(engine);
    expect(table.create_table_query).to.be.a('string');
  });

  it.skip('does not swallow ClickHouse error', (done) => {
    const { ddl, tableName } = getDDL();
    Promise.resolve()
      .then(() => runCommand(client, { query: ddl, format: 'TabSeparated' }))
      .then(() => runCommand(client, { query: ddl, format: 'TabSeparated' }))
      .catch((e: any) => {
        expect(e.code).to.equal('57');
        expect(e.type).to.equal('TABLE_ALREADY_EXISTS');
        // TODO remove whitespace from end
        expect(e.message).equal(`Table default.${tableName} already exists. `);
        done();
      });
  });

  it.skip('can specify a parameterized query', async () => {
    await runCommand(client, {
      query: '',
      query_params: {
        table_name: 'example',
      },
    });

    // FIXME: use different DDL based on the TestEnv
    const result = await client.select({
      query: `SELECT * from system.tables where name = 'example'`,
      format: 'JSON',
    });

    const { data, rows } = await result.json<
      ResponseJSON<{ name: string; engine: string; create_table_query: string }>
    >();

    expect(rows).to.equal(1);
    const table = data[0];
    expect(table.name).to.equal('example');
  });
});

function getDDL(): {
  ddl: string;
  tableName: string;
  engine: string;
} {
  const env = getClickHouseTestEnvironment();
  const tableName = `command_test_${guid()}`;
  switch (env) {
    // ENGINE can be omitted in the cloud statements:
    // it will use ReplicatedMergeTree and will add ON CLUSTER as well
    case TestEnv.Cloud: {
      const ddl = `
        CREATE TABLE ${tableName}
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ORDER BY (id)
      `;
      return { ddl, tableName, engine: 'ReplicatedMergeTree' };
    }
    case TestEnv.LocalSingleNode: {
      const ddl = `
        CREATE TABLE ${tableName}
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ENGINE = MergeTree()
        ORDER BY (id)
      `;
      return { ddl, tableName, engine: 'MergeTree' };
    }

    case TestEnv.LocalCluster: {
      const ddl = `
        CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
        (id UInt64, name String, sku Array(UInt8), timestamp DateTime)
        ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
        ORDER BY (id)
      `;
      return { ddl, tableName, engine: 'ReplicatedMergeTree' };
    }
  }
}

async function runCommand(
  client: ClickHouseClient,
  params: CommandParams
): Promise<string> {
  console.log(`Running command:\n${params.query}`);
  return (await client.command(params)).text();
}
