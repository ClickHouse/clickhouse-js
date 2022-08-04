import Http from 'http';
import Stream from 'stream';
import sinon, { type SinonStub } from 'sinon';
import Util from 'util';
import Zlib from 'zlib';

import { expect } from 'chai';
import { ConnectionParams } from '../../src/connection';
import { HttpAdapter } from '../../src/connection/adapter';
import { DummyLogger } from '../utils';
import { getAsText } from '../../src/utils';

const gzip = Util.promisify(Zlib.gzip);

function buildIncomingMessage({
  body = '',
  statusCode = 200,
  headers = {},
}: {
  body?: string | Buffer;
  statusCode?: number;
  headers?: Http.IncomingHttpHeaders;
}): Http.IncomingMessage {
  // @ts-expect-error doesn't mock all the props
  const response: Http.IncomingMessage = new Stream.Readable({
    read() {
      this.push(body);
      this.push(null);
    },
  });

  response.statusCode = statusCode;
  response.headers = headers;
  return response;
}

function buildHttpAdapter(config: Partial<ConnectionParams>) {
  return new HttpAdapter(
    {
      ...{
        host: 'http://localhost:8132',

        connect_timeout: 10_000,
        request_timeout: 30_000,
        compression: {
          decompress_response: true,
          compress_request: false,
        },
        // max_open_connections: number;

        username: '',
        password: '',
      },
      ...config,
    },
    new DummyLogger(false)
  );
}

describe('HttpAdapter', () => {
  describe('compression', () => {
    let httpRequestStub: SinonStub | undefined;

    beforeEach(() => {
      httpRequestStub = sinon.stub(Http, 'request');
    });

    afterEach(() => {
      httpRequestStub?.restore();
    });

    describe('response decompression', () => {
      it('hints ClickHouse server to send a gzip compressed response if compress_request: true', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });

        const request = new Stream.Writable({
          write() {
            /** stub */
          },
        });

        httpRequestStub?.returns(request);

        adapter.select({
          query: 'SELECT * from system.numbers LIMIT 5',
        });
        expect(httpRequestStub?.callCount).of.equal(1);

        const calledWith: { headers: Record<string, string> } =
          httpRequestStub?.getCall(0).args[0];

        expect(calledWith?.headers['Accept-Encoding']).to.equal('gzip');
      });

      it('does not send a compression algorithm hint if compress_request: false', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        });

        const request = new Stream.Writable({
          write() {
            /** stub */
          },
        });

        httpRequestStub?.returns(request);

        adapter.select({
          query: 'SELECT * from system.numbers LIMIT 5',
        });
        expect(httpRequestStub?.callCount).of.equal(1);

        const calledWith: { headers: Record<string, string> } =
          httpRequestStub?.getCall(0).args[0];

        expect(calledWith?.headers['Accept-Encoding']).to.equal(undefined);
      });

      it('request-specific settings take precedence over config settings', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        });

        const request = new Stream.Writable({
          write() {
            /** stub */
          },
        });

        httpRequestStub?.returns(request);

        adapter.select({
          query: 'SELECT * from system.numbers LIMIT 5',
          clickhouse_settings: {
            enable_http_compression: 1,
          },
        });
        expect(httpRequestStub?.callCount).of.equal(1);

        const calledWith: { headers: Record<string, string> } =
          httpRequestStub?.getCall(0).args[0];

        expect(calledWith?.headers['Accept-Encoding']).to.equal('gzip');
      });

      it('decompress a gzip response', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });

        const request = new Stream.Writable({
          write() {
            /** stub */
          },
        });

        httpRequestStub?.returns(request);

        const selectPromise = adapter.select({
          query: 'SELECT * from system.numbers LIMIT 5',
        });

        const responseBody = 'abc'.repeat(1_000);
        const compressedBody = await gzip(responseBody);
        request.emit(
          'response',
          buildIncomingMessage({
            body: compressedBody,
            headers: {
              'content-encoding': 'gzip',
            },
          })
        );

        expect(await getAsText(await selectPromise)).to.equal(responseBody);
      });

      it('throws on an unexpected encoding', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });

        const request = new Stream.Writable({
          write() {
            /** stub */
          },
        });

        httpRequestStub?.returns(request);

        const selectPromise = adapter.select({
          query: 'SELECT * from system.numbers LIMIT 5',
        });

        const responseBody = 'abc'.repeat(1_000);
        const compressedBody = await gzip(responseBody);
        request.emit(
          'response',
          buildIncomingMessage({
            body: compressedBody,
            headers: {
              'content-encoding': 'br',
            },
          })
        );

        try {
          await selectPromise;
          throw new Error('did not throw');
        } catch (e: any) {
          expect(e.message).to.equal('Unexpected encoding: br');
        }
      });
    });

    describe('request compression', () => {
      it('sends a compressed request if compress_request: true', (done) => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: true,
          },
        });

        const values = 'abc'.repeat(1_000);

        let chunks = Buffer.alloc(0);
        const request = new Stream.Writable({
          write(chunk, encoding, next) {
            chunks = Buffer.concat([chunks, chunk]);
            next();
          },
          final() {
            Zlib.unzip(chunks, (err, result) => {
              expect(result.toString('utf8')).to.equal(values);
              done();
            });
          },
        });

        httpRequestStub?.returns(request);

        adapter.insert({
          query: 'INSERT INTO insert_compression_table',
          values,
        });
        expect(httpRequestStub?.callCount).of.equal(1);

        const calledWith: { headers: Record<string, string> } =
          httpRequestStub?.getCall(0).args[0];

        expect(calledWith?.headers['Content-Encoding']).to.equal('gzip');
      });
    });
  });
});
