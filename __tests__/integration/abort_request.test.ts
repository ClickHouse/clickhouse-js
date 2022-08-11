import Stream from 'stream';
import { AbortController } from 'node-abort-controller';
import { expect } from 'chai';
import { type ClickHouseClient, type ResponseJSON } from '../../src';
import { createTable, createTestClient, guid } from '../utils';
import { TestEnv } from '../utils';

async function assertActiveQueries(
  client: ClickHouseClient,
  assertQueries: (queries: Array<{ query: string }>) => boolean
) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const rows = await client.select({
      query: 'SELECT query FROM system.processes',
      format: 'JSON',
    });

    const queries = await rows.json<ResponseJSON<{ query: string }>>();

    if (assertQueries(queries.data)) {
      break;
    }

    await new Promise((res) => setTimeout(res, 100));
  }
}

describe('abort request', () => {
  let client: ClickHouseClient;
  before(function () {
    if (process.env.browser) {
      this.skip();
    }
  });

  beforeEach(() => {
    client = createTestClient();
  });

  afterEach(async () => {
    await client.close();
  });

  describe('select', () => {
    it('cancels a select query before it is sent', (done) => {
      const controller = new AbortController();

      client
        .select({
          query: 'SELECT sleep(3)',
          format: 'CSV',
          abort_signal: controller.signal as AbortSignal,
        })
        .catch((error: Error) => {
          expect(error.message).to.equal('The request was aborted.');
          done();
        });

      controller.abort();
    });

    it('cancels a select query after it is sent', (done) => {
      const controller = new AbortController();

      client
        .select({
          query: 'SELECT sleep(3)',
          format: 'CSV',
          abort_signal: controller.signal as AbortSignal,
        })
        .catch((error: Error) => {
          expect(error.message).to.equal('The request was aborted.');
          done();
        });

      setTimeout(() => {
        controller.abort();
      }, 50);
    });

    it('cancels a select query while reading response', (done) => {
      const controller = new AbortController();

      client
        .select({
          query: 'SELECT * from system.numbers',
          format: 'JSONCompactEachRow',
          abort_signal: controller.signal as AbortSignal,
        })

        .then(async function (rows) {
          const stream = rows.asStream();
          for await (const chunk of stream) {
            const [[number]] = chunk.json();
            // abort when reach number 3
            if (number === '3') {
              controller.abort();
            }
          }
        })
        .catch(() => {
          // There is no assertion against an error message.
          // A race condition on events might lead to Request Aborted or ERR_STREAM_PREMATURE_CLOSE errors.
          done();
        });
    });

    it('cancels a select query while reading response by closing response stream', (done) => {
      void client
        .select({
          query: 'SELECT * from system.numbers',
          format: 'JSONCompactEachRow',
        })

        .then(async function (rows) {
          const stream = rows.asStream();
          for await (const chunk of stream) {
            const [[number]] = chunk.json();
            // abort when reach number 3
            if (number === '3') {
              stream.destroy();
            }
          }
          done();
        });
    });

    // FIXME: it does not work with ClickHouse Cloud.
    //  Active queries never contain the long running query unlike local setup.
    it.skip('ClickHouse server must cancel query on abort', async () => {
      const controller = new AbortController();

      const longRunningQuery = `SELECT sleep(3), '${guid()}'`;
      console.log(`Long running query: ${longRunningQuery}`);
      await client.select({
        query: longRunningQuery,
        abort_signal: controller.signal as AbortSignal,
        format: 'JSONCompactEachRow',
      });

      await assertActiveQueries(client, (queries) => {
        console.log(`Active queries: ${JSON.stringify(queries, null, 2)}`);
        return queries.some((q) => q.query.includes(longRunningQuery));
      });

      controller.abort();

      await assertActiveQueries(client, (queries) =>
        queries.every((q) => !q.query.includes(longRunningQuery))
      );
    });
  });

  describe('insert', () => {
    let tableName: string;
    beforeEach(async () => {
      tableName = `abort_request_insert_test_${guid()}`;
      await createTable(client, (env) => {
        switch (env) {
          // ENGINE can be omitted in the cloud statements:
          // it will use ReplicatedMergeTree and will add ON CLUSTER as well
          case TestEnv.Cloud:
            return `
              CREATE TABLE ${tableName}
              (id UInt64)
              ORDER BY (id)
            `;
          case TestEnv.LocalSingleNode:
            return `
              CREATE TABLE ${tableName}
              (id UInt64)
              ENGINE MergeTree()
              ORDER BY (id)
            `;
          case TestEnv.LocalCluster:
            return `
              CREATE TABLE ${tableName} ON CLUSTER '{cluster}'
              (id UInt64)
              ENGINE ReplicatedMergeTree('/clickhouse/{cluster}/tables/{database}/{table}/{shard}', '{replica}')
              ORDER BY (id)
            `;
        }
      });
    });

    it('cancels an insert query before it is sent', (done) => {
      const controller = new AbortController();

      const stream = new Stream.Readable({
        objectMode: true,
        read() {
          /* stub */
        },
      });

      client
        .insert({
          table: tableName,
          values: stream,
          abort_signal: controller.signal as AbortSignal,
        })
        .catch((error: Error & { code?: string }) => {
          expect(error.message).to.equal('The request was aborted.');
          done();
        });

      controller.abort();
    });

    it('cancels an insert query before it is sent by closing a stream', (done) => {
      const stream = new Stream.Readable({
        objectMode: true,
        read() {
          /* stub */
        },
      });

      stream.push(null);

      void client
        .insert({
          table: tableName,
          values: stream,
        })
        .then(done);
    });

    it('cancels an insert query after it is sent', (done) => {
      const controller = new AbortController();

      const stream = new Stream.Readable({
        objectMode: true,
        read() {
          /* stub */
        },
      });

      client
        .insert({
          table: tableName,
          values: stream,
          abort_signal: controller.signal as AbortSignal,
        })
        .catch((error: Error) => {
          expect(error.message).to.equal('The request was aborted.');
          done();
        });

      setTimeout(() => {
        controller.abort();
      }, 50);
    });
  });
});
