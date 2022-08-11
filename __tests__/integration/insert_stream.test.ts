import { expect } from 'chai';
import type { ResponseJSON } from '../../src';
import { type ClickHouseClient } from '../../src';
import Stream from 'stream';
import { createTable, createTestClient, guid } from '../utils';
import { TestEnv } from '../utils';

describe('insert stream', () => {
  before(function () {
    if (process.env.browser) {
      this.skip();
    }
  });

  let client: ClickHouseClient;
  let tableName: string;
  beforeEach(async () => {
    client = createTestClient();
    tableName = `insert_stream_test_${guid()}`;
    await createTable(client, (env) => {
      switch (env) {
        // ENGINE can be omitted in the cloud statements:
        // it will use ReplicatedMergeTree and will add ON CLUSTER as well
        case TestEnv.Cloud:
          return `
            CREATE TABLE ${tableName}
            (id UInt64, name String, sku Array(UInt8))
            ORDER BY (id)
          `;
        case TestEnv.LocalSingleNode:
          return `
            CREATE TABLE ${tableName}
            (id UInt64, name String, sku Array(UInt8))
            ENGINE MergeTree()
            ORDER BY (id)
          `;
        case TestEnv.LocalCluster:
          return `
            CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
            (id UInt64, name String, sku Array(UInt8))
            ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
            ORDER BY (id)
          `;
      }
    });
  });
  afterEach(async () => {
    await client.close();
  });

  it('can insert values as a Stream', async () => {
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        /* stub */
      },
    });

    stream.push([42, 'hello', [0, 1]]);
    stream.push([43, 'world', [3, 4]]);
    setTimeout(() => stream.push(null), 100);
    await client.insert({
      table: tableName,
      values: stream,
    });

    const Rows = await client.select({
      query: `SELECT * FROM ${tableName}`,
      format: 'JSONEachRow',
    });

    const result = await Rows.json<ResponseJSON>();
    expect(result).to.deep.equal([
      { id: '42', name: 'hello', sku: [0, 1] },
      { id: '43', name: 'world', sku: [3, 4] },
    ]);
  });

  it('does not throw if stream closes prematurely', async () => {
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        this.push(null); // close stream
      },
    });

    await client.insert({
      table: tableName,
      values: stream,
    });
  });

  it('waits for stream of values to be closed', async () => {
    let closed = false;
    const stream = new Stream.Readable({
      objectMode: true,
      read() {
        setTimeout(() => {
          this.push([42, 'hello', [0, 1]]);
          this.push([43, 'world', [3, 4]]);
          this.push(null);
          closed = true;
        }, 100);
      },
    });

    expect(closed).to.equal(false);
    await client.insert({
      table: tableName,
      values: stream,
    });
    expect(closed).to.equal(true);
  });
});
