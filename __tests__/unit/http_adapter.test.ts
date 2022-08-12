import Http, { ClientRequest } from 'http';
import Stream from 'stream';
import Util from 'util';
import Zlib from 'zlib';
import { ConnectionParams } from '../../src/connection';
import { HttpAdapter } from '../../src/connection/adapter';
import { retryOnFailure, TestLogger } from '../utils';
import { getAsText } from '../../src/utils';

describe('HttpAdapter', () => {
  const gzip = Util.promisify(Zlib.gzip);
  const httpRequestStub = jest.spyOn(Http, 'request');

  describe('compression', () => {
    describe('response decompression', () => {
      it('hints ClickHouse server to send a gzip compressed response if compress_request: true', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });

        const request = stubRequest();

        const selectPromise = adapter.select({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        });

        const responseBody = 'foobar';
        await emitCompressedBody(request, responseBody);

        await selectPromise;
        assertStub('gzip');
      });

      it('does not send a compression algorithm hint if compress_request: false', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        });
        const request = stubRequest();

        const selectPromise = adapter.select({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        });

        const responseBody = 'foobar';
        request.emit(
          'response',
          buildIncomingMessage({
            body: responseBody,
          })
        );

        expect(await getAsText(await selectPromise)).toBe(responseBody);
        assertStub(undefined);
      });

      it('uses request-specific settings over config settings', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: false,
          },
        });
        const request = stubRequest();

        const selectPromise = adapter.select({
          query: 'SELECT * FROM system.numbers LIMIT 5',
          clickhouse_settings: {
            enable_http_compression: 1,
          },
        });

        const responseBody = 'foobar';
        await emitCompressedBody(request, responseBody);

        expect(await getAsText(await selectPromise)).toBe(responseBody);
        assertStub('gzip');
      });

      it('decompresses a gzip response', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });
        const request = stubRequest();

        const selectPromise = adapter.select({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        });

        const responseBody = 'abc'.repeat(1_000);
        await emitCompressedBody(request, responseBody);

        expect(await getAsText(await selectPromise)).toBe(responseBody);
      });

      it('throws on an unexpected encoding', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });
        const request = stubRequest();

        const selectPromise = adapter.select({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        });

        await emitCompressedBody(request, 'abc', 'br');

        await expect(selectPromise).rejects.toMatchObject({
          message: 'Unexpected encoding: br',
        });
      });

      it('provides decompression error to a stream consumer', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: true,
            compress_request: false,
          },
        });
        const request = stubRequest();

        const selectPromise = adapter.select({
          query: 'SELECT * FROM system.numbers LIMIT 5',
        });

        // No GZIP encoding for the body here
        request.emit(
          'response',
          buildIncomingMessage({
            body: 'abc',
            headers: {
              'content-encoding': 'gzip',
            },
          })
        );

        await expect(async () => {
          const response = await selectPromise;
          for await (const chunk of response) {
            void chunk; // stub
          }
        }).rejects.toMatchObject({
          message: 'incorrect header check',
          code: 'Z_DATA_ERROR',
        });
      });

      function assertStub(encoding: string | undefined) {
        expect(httpRequestStub).toBeCalledTimes(1);
        const calledWith = httpRequestStub.mock.calls[0][1];
        expect(calledWith.headers!['Accept-Encoding']).toBe(encoding);
      }
    });

    describe('request compression', () => {
      it('sends a compressed request if compress_request: true', async () => {
        const adapter = buildHttpAdapter({
          compression: {
            decompress_response: false,
            compress_request: true,
          },
        });

        const values = 'abc'.repeat(1_000);

        let chunks = Buffer.alloc(0);
        let finalResult: Buffer | undefined = undefined;
        const request = new Stream.Writable({
          write(chunk, encoding, next) {
            chunks = Buffer.concat([chunks, chunk]);
            next();
          },
          final() {
            Zlib.unzip(chunks, (err, result) => {
              finalResult = result;
            });
          },
        }) as ClientRequest;

        httpRequestStub.mockReturnValueOnce(request);

        void adapter.insert({
          query: 'INSERT INTO insert_compression_table',
          values,
        });

        await retryOnFailure(async () => {
          expect(finalResult!.toString('utf8')).toEqual(values);
        });
        assertStub('gzip');
      });

      function assertStub(encoding: string | undefined) {
        expect(httpRequestStub).toBeCalledTimes(1);
        const calledWith = httpRequestStub.mock.calls[0][1];
        expect(calledWith.headers!['Content-Encoding']).toBe(encoding);
      }
    });

    function stubRequest() {
      const request = new Stream.Writable({
        write() {
          /** stub */
        },
      }) as ClientRequest;
      httpRequestStub.mockReturnValueOnce(request);
      return request;
    }

    async function emitCompressedBody(
      request: ClientRequest,
      body: string,
      encoding = 'gzip'
    ) {
      const compressedBody = await gzip(body);
      request.emit(
        'response',
        buildIncomingMessage({
          body: compressedBody,
          headers: {
            'content-encoding': encoding,
          },
        })
      );
    }
  });

  function buildIncomingMessage({
    body = '',
    statusCode = 200,
    headers = {},
  }: {
    body?: string | Buffer;
    statusCode?: number;
    headers?: Http.IncomingHttpHeaders;
  }): Http.IncomingMessage {
    const response = new Stream.Readable({
      read() {
        this.push(body);
        this.push(null);
      },
    }) as Http.IncomingMessage;

    response.statusCode = statusCode;
    response.headers = headers;
    return response;
  }

  function buildHttpAdapter(config: Partial<ConnectionParams>) {
    return new HttpAdapter(
      {
        ...{
          host: new URL('http://localhost:8132'),

          connect_timeout: 10_000,
          request_timeout: 30_000,
          compression: {
            decompress_response: true,
            compress_request: false,
          },
          // max_open_connections: number;

          username: '',
          password: '',
          database: '',
        },
        ...config,
      },
      new TestLogger(true)
    );
  }
});
