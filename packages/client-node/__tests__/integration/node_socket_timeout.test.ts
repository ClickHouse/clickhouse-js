import type { ClickHouseClient } from '@clickhouse/client-common'
import { permutations } from '@test/utils'
import { createTestClient } from '@test/utils'
import * as http from 'http'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'

const ServerTimeout = 20 // ms
const ClientTimeout = 10 // ms
const Iterations = 5
const MaxOpenConnections = 2

describe('Node.js socket timeout handling', () => {
  let client: ClickHouseClient<Stream.Readable>
  let server: http.Server

  beforeAll(async () => {
    // Simulate a ClickHouse server that does not respond to the request in time
    server = http.createServer(async (req, res) => {
      await new Promise((resolve) => setTimeout(resolve, ServerTimeout))
      res.write('Ok.')
      return res.end()
    })
    server.listen(18123)
    // Client has request timeout set to lower than the server's "sleep" time
    client = createTestClient({
      url: 'http://localhost:18123',
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
