import { expect } from 'chai';
import { createClient, type ClickHouseClient } from '../../src';
import Stream from 'stream';
import type { ResponseJSON } from '../../src/clickhouse_types';

describe('insert', () => {
  before(function () {
    if (process.env.browser) {
      this.skip();
    }
  });

  let client: ClickHouseClient;
  beforeEach(async () => {
    client = createClient();
    const ddl =
      'CREATE TABLE test_table (id UInt64, name String, sku Array(UInt8)) Engine = Memory';
    await client.command({
      query: ddl,
    });
  });
  afterEach(async () => {
    await client.command({ query: 'DROP TABLE test_table' });
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
      table: 'test_table',
      values: stream,
    });

    const Rows = await client.select({
      query: 'SELECT * FROM test_table',
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
      table: 'test_table',
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
      table: 'test_table',
      values: stream,
    });
    expect(closed).to.equal(true);
  });
});
