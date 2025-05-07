import { sleep } from '@test/utils'
import Http, { type ClientRequest } from 'http'
import Stream from 'stream'
import Zlib from 'zlib'
import { assertConnQueryResult } from '../utils/assert'
import {
  buildHttpConnection,
  buildIncomingMessage,
  emitCompressedBody,
  emitResponseBody,
  socketStub,
  stubClientRequest,
} from '../utils/http_stubs'

describe('Node.js Connection compression', () => {
  let httpRequestStub: jasmine.Spy<typeof Http.request>
  beforeEach(() => {
    httpRequestStub = spyOn(Http, 'request')
  })

  describe('response decompression', () => {
    it('hints ClickHouse server to send a gzip compressed response if compress_request: true', async () => {
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: true,
          compress_request: false,
        },
      })

      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })

      const responseBody = 'foobar'
      await emitCompressedBody(request, responseBody)

      await selectPromise

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(
        (calledWith.headers as Record<string, string>)['Accept-Encoding'],
      ).toBe('gzip')
    })

    it('does not send a compression algorithm hint if compress_request: false', async () => {
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })

      const responseBody = 'foobar'
      await emitResponseBody(request, responseBody)

      const queryResult = await selectPromise
      await assertConnQueryResult(queryResult, responseBody)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(
        (calledWith.headers as Record<string, string | undefined>)[
          'Accept-Encoding'
        ],
      ).toBe(undefined)
    })

    it('uses request-specific settings over config settings', async () => {
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: false,
        },
      })

      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
        clickhouse_settings: {
          enable_http_compression: 1,
        },
      })

      const responseBody = 'foobar'
      await emitCompressedBody(request, responseBody)

      const queryResult = await selectPromise
      await assertConnQueryResult(queryResult, responseBody)

      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(
        (calledWith.headers as Record<string, string>)['Accept-Encoding'],
      ).toBe('gzip')
    })

    it('decompresses a gzip response', async () => {
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: true,
          compress_request: false,
        },
      })

      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })

      const responseBody = 'abc'.repeat(1_000)
      await emitCompressedBody(request, responseBody)

      const queryResult = await selectPromise
      await assertConnQueryResult(queryResult, responseBody)
    })

    it('throws on an unexpected encoding', async () => {
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: true,
          compress_request: false,
        },
      })

      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })

      await emitCompressedBody(request, 'abc', 'br')

      await expectAsync(selectPromise).toBeRejectedWith(
        jasmine.objectContaining({
          message: 'Unexpected encoding: br',
        }),
      )
    })

    it('provides decompression error to a stream consumer', async () => {
      const request = stubClientRequest()
      httpRequestStub.and.returnValue(request)
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: true,
          compress_request: false,
        },
      })

      const selectPromise = adapter.query({
        query: 'SELECT * FROM system.numbers LIMIT 5',
      })

      // No GZIP encoding for the body here
      await sleep(0)
      request.emit(
        'response',
        buildIncomingMessage({
          body: 'abc',
          headers: {
            'content-encoding': 'gzip',
          },
        }),
      )

      const readStream = async () => {
        const { stream } = await selectPromise
        for await (const chunk of stream) {
          void chunk // stub
        }
      }

      await expectAsync(readStream()).toBeRejectedWith(
        jasmine.objectContaining({
          message: 'incorrect header check',
          code: 'Z_DATA_ERROR',
        }),
      )
    })
  })

  describe('request compression', () => {
    it('sends a compressed request if compress_request: true', async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: false,
          compress_request: true,
        },
      })

      const values = 'abc'.repeat(1_000)

      let chunks = Buffer.alloc(0)
      let finalResult: Buffer | undefined = undefined
      const request = new Stream.Writable({
        write(chunk, encoding, next) {
          chunks = Buffer.concat([chunks, chunk])
          next()
        },
        final() {
          Zlib.unzip(chunks, (_err, result) => {
            finalResult = result
          })
        },
      }) as ClientRequest
      httpRequestStub.and.returnValue(request)

      void adapter.insert({
        query: 'INSERT INTO insert_compression_table',
        values,
      })

      // trigger stream pipeline
      await sleep(0)
      request.emit('socket', socketStub)
      await sleep(100)

      expect(finalResult!.toString('utf8')).toEqual(values)
      expect(httpRequestStub).toHaveBeenCalledTimes(1)
      const calledWith = httpRequestStub.calls.mostRecent().args[1]
      expect(
        (calledWith.headers as Record<string, string>)['Content-Encoding'],
      ).toBe('gzip')
    })
  })
})
