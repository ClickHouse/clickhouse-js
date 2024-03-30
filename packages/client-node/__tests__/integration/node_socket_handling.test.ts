import type {
  ClickHouseClient,
  ConnPingResult,
} from '@clickhouse/client-common'
import { permutations } from '@test/utils'
import { createTestClient } from '@test/utils'
import * as http from 'http'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'

const SlowServerLag = 20 // ms
const ClientTimeout = 10 // ms
const Iterations = 5
const MaxOpenConnections = 2

describe('Node.js socket handling', () => {
  let client: ClickHouseClient<Stream.Readable>
  let server: http.Server

  describe('Slow server', () => {
    const port = 18123
    beforeAll(async () => {
      // Simulate a ClickHouse server that does not respond to the request in time
      server = http.createServer(async (req, res) => {
        await new Promise((resolve) => setTimeout(resolve, SlowServerLag))
        res.write('Ok.')
        return res.end()
      })
      server.listen(port)
      // Client has request timeout set to lower than the server's "sleep" time
      client = createTestClient({
        url: `http://localhost:${port}`,
        request_timeout: ClientTimeout,
        max_open_connections: MaxOpenConnections,
        keep_alive: {
          enable: true,
        },
      } as NodeClickHouseClientConfigOptions)
    })
    afterAll(async () => {
      await client.close()
      server.close()
    })

    // ping first, then 2 operations in all possible combinations - repeat every combination several times
    it('should work with all operations permutations', async () => {
      const allOps: Array<{ opName: string; fn: () => Promise<unknown> }> = [
        { fn: select, opName: 'query' },
        { fn: insert, opName: 'insert' },
        { fn: exec, opName: 'exec' },
        { fn: command, opName: 'command' },
      ]
      const opsPermutations = permutations(allOps, 2)
      for (const ops of opsPermutations) {
        for await (const { fn, opName } of ops) {
          for (let i = 1; i <= Iterations; i++) {
            const pingResult = await ping()
            expect(pingResult.success).toBeFalse()
            expect((pingResult as { error: Error }).error.message).toEqual(
              jasmine.stringContaining('Timeout error.'),
            )
            await expectAsync(fn())
              .withContext(
                `${opName} should have been rejected. Current ops: ${ops
                  .map(({ opName }) => opName)
                  .join(', ')}`,
              )
              .toBeRejectedWithError('Timeout error.')
          }
        }
      }
      expect().nothing()
    })

    it('should not throw unhandled errors with Ping', async () => {
      for (let i = 1; i <= Iterations; i++) {
        const pingResult = await client.ping()
        expect(pingResult.success).toBeFalse()
        expect((pingResult as { error: Error }).error.message).toEqual(
          jasmine.stringContaining('Timeout error.'),
        )
      }
      expect().nothing()
    })

    it('should not throw unhandled errors with Select', async () => {
      for (let i = 1; i <= Iterations; i++) {
        await expectAsync(select()).toBeRejectedWithError('Timeout error.')
      }
      expect().nothing()
    })

    it('should not throw unhandled errors with Insert', async () => {
      for (let i = 1; i <= Iterations; i++) {
        await expectAsync(insert()).toBeRejectedWithError('Timeout error.')
      }
      expect().nothing()
    })

    it('should not throw unhandled errors with Command', async () => {
      for (let i = 1; i <= Iterations; i++) {
        await expectAsync(command()).toBeRejectedWithError('Timeout error.')
      }
      expect().nothing()
    })

    it('should not throw unhandled errors with Exec', async () => {
      for (let i = 1; i <= Iterations; i++) {
        await expectAsync(exec()).toBeRejectedWithError('Timeout error.')
      }
      expect().nothing()
    })

    it('should not throw unhandled errors with parallel Select operations', async () => {
      for (let i = 1; i <= Iterations; i++) {
        const promises = [...new Array(MaxOpenConnections)].map(async () => {
          await expectAsync(select()).toBeRejectedWithError('Timeout error.')
        })
        await Promise.all(promises)
      }
    })
  })

  describe('Server that never responds', () => {
    const port = 18124
    let timeoutId: ReturnType<typeof setTimeout>
    let requestCount = 0

    beforeAll(async () => {
      // Simulate an LB where the server is not available
      server = http.createServer(async (req, res) => {
        requestCount++
        if (requestCount === Iterations) {
          res.write('Ok.')
          return res.end()
        } else {
          await new Promise(
            (resolve) => (timeoutId = setTimeout(resolve, 600_000)),
          )
        }
      })
      server.listen(port)
      // Client has request timeout set to lower than the server's "sleep" time
      client = createTestClient({
        url: `http://localhost:${port}`,
        request_timeout: ClientTimeout,
        keep_alive: {
          enable: true,
        },
      } as NodeClickHouseClientConfigOptions)
    })
    afterEach(() => {
      requestCount = 0
    })
    afterAll(async () => {
      await client.close()
      clearTimeout(timeoutId)
      server.close()
    })

    it('should eventually get a successful ping', async () => {
      for (let i = 1; i < Iterations; i++) {
        const pingResult = await ping()
        expect(pingResult.success).toBeFalse()
        expect(
          (pingResult as ConnPingResult & { success: false }).error.message,
        ).toEqual('Timeout error.')
      }
      // The last request should be successful
      expect(await ping()).toEqual({ success: true })
    })
  })

  describe('Resource is not available', () => {
    const port = 18125
    beforeAll(async () => {
      // Client has request timeout set to lower than the server's "sleep" time
      client = createTestClient({
        url: `http://localhost:${port}`,
        request_timeout: ClientTimeout,
        max_open_connections: MaxOpenConnections,
        keep_alive: {
          enable: true,
        },
      } as NodeClickHouseClientConfigOptions)
    })
    afterAll(async () => {
      await client.close()
      server.close()
    })

    it('should fail with a connection error, but then reach out to the server', async () => {
      // Try to reach to the unavailable server a few times
      for (let i = 1; i <= Iterations; i++) {
        const pingResult = await ping()
        expect(pingResult.success).toBeFalse()
        const error = (pingResult as ConnPingResult & { success: false }).error
        expect((error as NodeJS.ErrnoException).code).toEqual('ECONNREFUSED')
      }
      // now we start the server, and it is available; and we should have already used every socket in the pool      server = http.createServer(async (req, res) => {
      server = http.createServer(async (req, res) => {
        res.write('Ok.')
        return res.end()
      })
      server.listen(port)
      // no socket timeout or other errors
      expect(await ping()).toEqual({ success: true })
    })
  })

  async function ping() {
    return client.ping()
  }

  async function select() {
    const rs = await client.query({ query: 'SELECT 1' })
    return rs.text()
  }

  async function insert() {
    await client.insert({
      table: 'test',
      values: [{ x: 1 }],
    })
  }

  async function exec() {
    await client.exec({ query: 'SELECT 1' })
  }

  async function command() {
    await client.command({ query: 'SELECT 1' })
  }
})
