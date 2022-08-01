import Stream from 'stream';
import { AbortController } from 'node-abort-controller';
import { expect } from 'chai';
import {
  createClient,
  type ClickHouseClient,
  type ResponseJSON,
} from '../../src';

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
    client = createClient();
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
            // abort when when reach number 3
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
      client
        .select({
          query: 'SELECT * from system.numbers',
          format: 'JSONCompactEachRow',
        })

        .then(async function (rows) {
          const stream = rows.asStream();
          for await (const chunk of stream) {
            const [[number]] = chunk.json();
            // abort when when reach number 3
            if (number === '3') {
              stream.destroy();
            }
          }
          done();
        });
    });

    it('ClickHouse server must cancel query on abort', async () => {
      const controller = new AbortController();

      const longRunningQuery = 'SELECT * FROM system.numbers';
      client.select({
        query: longRunningQuery,
        abort_signal: controller.signal as AbortSignal,
        format: 'JSONCompactEachRow',
      });

      await assertActiveQueries(client, (queries) =>
        queries.some((q) => q.query.includes(longRunningQuery))
      );

      controller.abort();

      await assertActiveQueries(client, (queries) =>
        queries.every((q) => !q.query.includes(longRunningQuery))
      );
    });
  });

  describe('insert', () => {
    beforeEach(async () => {
      const ddl = 'CREATE TABLE test_table (id UInt64) Engine = Memory';
      await client.command({ query: ddl });
    });

    afterEach(async () => {
      await client.command({ query: 'DROP TABLE test_table' });
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
          table: 'test_table',
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

      client
        .insert({
          table: 'test_table',
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
          table: 'test_table',
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
