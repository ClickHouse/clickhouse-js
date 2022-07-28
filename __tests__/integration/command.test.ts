import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';
import type { ResponseJSON } from '../../src/clickhouse_types';

describe('command', () => {
  let client: ClickHouseClient;
  afterEach(async () => {
    await client.command({ query: 'DROP TABLE example' });
    await client.close();
  });

  it('sends a command to execute', async() => {
    client = createClient();
    const ddl = 'CREATE TABLE example (id UInt64, name String, sku Array(UInt8), timestamp DateTime) Engine = Memory';

    await client.command({ query: ddl });

    const result = await client.select({
      query: `SELECT * from system.tables where name = 'example'`,
      format: 'JSON'
    });

    const { data, rows } = await result.json<ResponseJSON<{ name: string, engine: string, create_table_query: string }>>();

    expect(rows).to.equal(1);
    const table = data[0];
    expect(table.name).equal('example');
    expect(table.engine).equal('Memory');
    expect(table.create_table_query).to.be.a('string');
  });

  it('does not swallow ClickHouse error', (done) => {
    client = createClient();

    const ddl = 'CREATE TABLE example (id UInt64, name String, sku Array(UInt8), timestamp DateTime) Engine = Memory';

    Promise.resolve()
      .then(() => client.command({ query: ddl }))
      .then(() => client.command({ query: ddl }))
      .catch ((e: any) =>  {
        expect(e.code).to.equal('57');
        expect(e.type).to.equal('TABLE_ALREADY_EXISTS');
        // TODO remove whitespace from end
        expect(e.message).equal('Table default.example already exists. ');
        done();
      });
  });

  it.skip('can specify a parameterized query', async () => {
    client = createClient();
    await client.command({
      query: 'CREATE TABLE {table_name: String} (id UInt64, name String, sku Array(UInt8), timestamp DateTime) Engine = Memory',
      query_params: {
        table_name: 'example'
      }
    });

    const result = await client.select({
      query: `SELECT * from system.tables where name = 'example'`,
      format: 'JSON'
    });

    const { data, rows } = await result.json<ResponseJSON<{ name: string, engine: string, create_table_query: string }>>();

    expect(rows).to.equal(1);
    const table = data[0];
    expect(table.name).to.equal('example');
  });
});