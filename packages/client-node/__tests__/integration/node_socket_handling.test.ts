import type {
  ClickHouseClient,
  ConnPingResult,
} from '@clickhouse/client-common'
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest'
import { permutations } from '@test/utils/permutations'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { AddressInfo } from 'net'

const SlowServerLag = 20 // ms
const ClientTimeout = 10 // ms
const Iterations = 5
const MaxOpenConnections = 2

describe('Slow server', () => {
  let client: ClickHouseClient<Stream.Readable>
  let server: http.Server | null = null
  let port: number

  beforeAll(async () => {
    // Simulate a ClickHouse server that does not respond to the request in time
    ;[server, port] = await createServer(async (req, res) => {
      await sleep(SlowServerLag)
      res.write('Ok.')
      return res.end()
    })
    // Client has request timeout set to lower than the server's "sleep" time
    client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: ClientTimeout,
      max_open_connections: MaxOpenConnections,
      keep_alive: {
        enable: true,
      },
    } as NodeClickHouseClientConfigOptions)
  })
  afterAll(async () => {
    await client.close()
    server && (await closeServer(server))
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
          const pingResult = await client.ping()
          expect(pingResult.success).toBeFalsy()
          expect((pingResult as { error: Error }).error.message).toEqual(
            expect.stringContaining('Timeout error.'),
          )
          await expect(
            fn(),
            `${opName} should have been rejected. Current ops: ${ops
              .map(({ opName }) => opName)
              .join(', ')}`,
          ).rejects.toThrow('Timeout error.')
        }
      }
    }
  })

  it('should not throw unhandled errors with Ping', async () => {
    for (let i = 1; i <= Iterations; i++) {
      const pingResult = await client.ping()
      expect(pingResult.success).toBeFalsy()
      expect((pingResult as { error: Error }).error.message).toEqual(
        expect.stringContaining('Timeout error.'),
      )
    }
  })

  it('should not throw unhandled errors with Select', async () => {
    for (let i = 1; i <= Iterations; i++) {
      await expect(select()).rejects.toThrow('Timeout error.')
    }
  })

  it('should not throw unhandled errors with Insert', async () => {
    for (let i = 1; i <= Iterations; i++) {
      await expect(insert()).rejects.toThrow('Timeout error.')
    }
  })

  it('should not throw unhandled errors with Command', async () => {
    for (let i = 1; i <= Iterations; i++) {
      await expect(command()).rejects.toThrow('Timeout error.')
    }
  })

  it('should not throw unhandled errors with Exec', async () => {
    for (let i = 1; i <= Iterations; i++) {
      await expect(exec()).rejects.toThrow('Timeout error.')
    }
  })

  it('should not throw unhandled errors with parallel Select operations', async () => {
    for (let i = 1; i <= Iterations; i++) {
      const promises = [...new Array(MaxOpenConnections)].map(async () => {
        await expect(select()).rejects.toThrow('Timeout error.')
      })
      await Promise.all(promises)
    }
  })

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

describe('Server that times out', () => {
  it('should eventually get a successful ping', async () => {
    let requestCount = 0
    // Simulate an LB where the server is not available
    const [server, port] = await createServer(async (req, res) => {
      requestCount++
      if (requestCount >= 2) {
        res.write('Ok.')
        return res.end()
      } else {
        // don't respond
        // just keep the connection open until the client times out
      }
    })
    // Client has request timeout set to lower than the server's "sleep" time
    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: 100,
      keep_alive: {
        enabled: true,
      },
    })

    // The first request should fail with a timeout error
    const pingResult = await client.ping()
    expect(pingResult.success).toBeFalsy()
    expect(
      (pingResult as ConnPingResult & { success: false }).error.message,
    ).toEqual('Timeout error.')

    // The second request should be successful
    expect(await client.ping()).toEqual({ success: true })

    await client.close()
    await closeServer(server)
  })
})

describe('Resource is not available', () => {
  let client: ClickHouseClient<Stream.Readable>
  let server: http.Server | undefined
  const port = 18125
  beforeAll(async () => {
    // Client has request timeout set to lower than the server's "sleep" time
    client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: ClientTimeout,
      max_open_connections: MaxOpenConnections,
      keep_alive: {
        enable: true,
      },
    } as NodeClickHouseClientConfigOptions)
  })
  afterAll(async () => {
    await client.close()
    await closeServer(server!)
  })

  it('should fail with a connection error, but then reach out to the server', async () => {
    // Try to reach to the unavailable server a few times
    for (let i = 1; i <= Iterations; i++) {
      const pingResult = await client.ping()
      expect(pingResult.success).toBeFalsy()
      if (pingResult.success) {
        // suggest to TS what type pingResult is
        throw new Error('Ping should have failed')
      }
      const error = pingResult.error
      expect((error as NodeJS.ErrnoException).code).toEqual('ECONNREFUSED')
    }
    // now we start the server, and it is available; and we should have already used every socket in the pool
    ;[server] = await createServer(async (req, res) => {
      res.write('Ok.')
      return res.end()
    }, port)
    // no socket timeout or other errors
    expect(await client.ping()).toEqual({ success: true })
  })
})

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function closeServer(server: http.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

async function createServer(
  cb: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  port: number = 0,
): Promise<[http.Server, number]> {
  const server = http.createServer(cb)
  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })
  return [server, (server.address() as AddressInfo).port]
}
