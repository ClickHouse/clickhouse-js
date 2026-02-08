import type { ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeEach, afterEach, expect } from 'vitest'
import { createTestClient } from '../utils/client.node'
import http from 'http'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'

describe('[Node.js] Compression', () => {
  const port = 18123

  let client: ClickHouseClient<Stream.Readable>
  let server: http.Server

  describe('Malformed compression response', () => {
    const logAndQuit = (err: Error | unknown, prefix: string) => {
      console.error(prefix, err)
      expect.fail(
        `An unexpected error was propagated to the global context: ${prefix} ${err}`,
      )
    }
    const uncaughtExceptionListener = (err: Error) =>
      logAndQuit(err, 'uncaughtException:')
    const unhandledRejectionListener = (err: unknown) =>
      logAndQuit(err, 'unhandledRejection:')

    beforeEach(async () => {
      process.on('uncaughtException', uncaughtExceptionListener)
      process.on('unhandledRejection', unhandledRejectionListener)
      client = createTestClient({
        url: `http://localhost:${port}`,
        compression: {
          response: true,
        },
      } as NodeClickHouseClientConfigOptions)
    })
    afterEach(async () => {
      process.off('uncaughtException', uncaughtExceptionListener)
      process.off('unhandledRejection', unhandledRejectionListener)
      await client.close()
      server.close()
    })

    it('should not propagate the exception to the global context if a failed response is malformed', async () => {
      server = http.createServer(async (_req, res) => {
        return makeResponse(res, 500)
      })
      server.listen(port)

      // The request fails completely (and the error message cannot be decompressed)
      await expect(
        client.query({
          query: 'SELECT 1',
          format: 'JSONEachRow',
        }),
      ).rejects.toMatchObject({
        code: 'Z_DATA_ERROR',
      })
    })

    it('should not propagate the exception to the global context if a successful response is malformed', async () => {
      server = http.createServer(async (_req, res) => {
        return makeResponse(res, 200)
      })
      server.listen(port)

      const rs = await client.query({
        query: 'SELECT 1',
        format: 'JSONEachRow',
      })

      // Fails during the response streaming
      await expect(rs.text()).rejects.toThrow()
    })
  })

  function makeResponse(res: http.ServerResponse, status: 200 | 500) {
    res.appendHeader('Content-Encoding', 'gzip')
    res.statusCode = status
    res.write('A malformed response without compression')
    return res.end()
  }
})
