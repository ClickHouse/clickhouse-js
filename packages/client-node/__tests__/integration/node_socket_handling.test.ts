import type {
  ClickHouseClient,
  ConnPingResult,
} from '@clickhouse/client-common'
import { describe, it, beforeAll, afterAll, afterEach, expect } from 'vitest'
import { permutations } from '@test/utils/permutations'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import net from 'net'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { AddressInfo } from 'net'

const ClientTimeout = 10 // ms
const Iterations = 5
const MaxOpenConnections = 2

describe.concurrent('Slow server', () => {
  let client: ClickHouseClient<Stream.Readable>
  let server: http.Server | null = null
  let port: number
  let sleepServerPromise: Promise<void>
  let sleepServerPromiseResolve: () => void

  beforeAll(async () => {
    sleepServerPromise = new Promise<void>((resolve) => {
      sleepServerPromiseResolve = resolve
      // Simulate a ClickHouse server that responds with a delay
    })

    // Simulate a ClickHouse server that does not respond to the request in time
    ;[server, port] = await createHTTPServer(async (req, res) => {
      await sleepServerPromise
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
    sleepServerPromiseResolve()
    server && (await closeServer(server))
  })

  const allOps = [
    { fn: select, opName: 'query' },
    { fn: insert, opName: 'insert' },
    { fn: exec, opName: 'exec' },
    { fn: command, opName: 'command' },
  ]

  // Lightly entering the fuzzing zone.
  // Ping first, then 2 operations in all possible combinations
  it.for<typeof allOps>(permutations(allOps, 2))(
    'should work with all operations permutations',
    async (ops) => {
      for (const { fn, opName } of ops) {
        const pingResult = await client.ping()
        expect(pingResult.success).toBeFalsy()
        expect((pingResult as { error: Error }).error.message).toEqual(
          expect.stringContaining('Timeout error.'),
        )
        await expect(
          fn(),
          `${opName} should have been rejected. Current ops: ${JSON.stringify(ops)}`,
        ).rejects.toThrow('Timeout error.')
      }
    },
  )

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
    await rs.text()
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
    const [server, port] = await createHTTPServer(async (req, res) => {
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
    ;[server] = await createHTTPServer(async (req, res) => {
      res.write('Ok.')
      return res.end()
    }, port)
    // no socket timeout or other errors
    expect(await client.ping()).toEqual({ success: true })
  })
})

describe.concurrent('Server that drops connections', () => {
  it('should expose "socket hang up" error', async () => {
    const [server, port] = await createTCPServer(async (socket) => {
      drainSocket(socket)
      socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n')
      await sleep(10)
      // close the connection without sending the rest of the response headers or body
      socket.end()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enable: true,
      },
    } as NodeClickHouseClientConfigOptions)

    const result = await client.ping()

    expect(result).toMatchObject({ success: false })
    if (result.success) {
      throw new Error('Ping should have failed')
    }
    expect(String(result.error)).toMatch(/socket hang up/)

    await client.close()
    await closeServer(server)
  })

  it('should expose "invalid header token" error', async () => {
    const [server, port] = await createTCPServer(async (socket) => {
      drainSocket(socket)
      socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nOk.\r\n')
      await sleep(10)
      socket.end()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enable: true,
      },
    } as NodeClickHouseClientConfigOptions)

    const result = await client.ping()

    expect(result).toMatchObject({ success: false })
    if (result.success) {
      throw new Error('Ping should have failed')
    }
    expect(String(result.error)).toMatch(/invalid header/i)

    await client.close()
    await closeServer(server)
  })

  it('should expose "aborted" error', async () => {
    const [server, port] = await createTCPServer(async (socket) => {
      drainSocket(socket)
      socket.write(
        'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length:100\r\n\r\npartial body',
      )
      await sleep(10)
      socket.end()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enable: true,
      },
    } as NodeClickHouseClientConfigOptions)

    const result = await client.ping()

    expect(result).toMatchObject({ success: false })
    if (result.success) {
      throw new Error('Ping should have failed')
    }
    expect(String(result.error)).toMatch(/aborted/i)

    await client.close()
    await closeServer(server)
  })

  it('should expose "ECONNRESET" error', async () => {
    let sleepServerPromiseResolve: () => void
    let sleepServerPromise = new Promise<void>((resolve) => {
      sleepServerPromiseResolve = resolve
      // Simulate a ClickHouse server that responds with a delay
    })

    let attempted = 0
    const [server, port] = await createTCPServer(async (socket) => {
      attempted++
      if (attempted >= 2) {
        socket.destroy()
        throw new Error('Extra connection attempt - should not happen')
      }
      // Write a valid response
      socket.write(
        'HTTP/1.1 200 OK\r\n' +
          'Content-Type: text/plain\r\n' +
          'Content-Length: 3\r\n' +
          'Connection: keep-alive\r\n' +
          '\r\n' +
          'Ok.',
      )
      // Then start the next request
      await sleepServerPromise
      // …and then drop the connection before sending the full response
      socket.destroy()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enable: true,
      },
      log: {
        level: 0,
      },
      max_open_connections: 1,
    } as NodeClickHouseClientConfigOptions)

    expect(await client.ping()).toMatchObject({ success: true })

    let ping2 = client.ping()
    // Client has a sleep(0) inside, the test has to wait for it to complete,
    // otherwise the socket gets closed before the client gets to use it.
    // This way we get the "socket hang up" error instead of "ECONNRESET".
    await sleep(0)
    sleepServerPromiseResolve!()
    ping2 = await ping2

    expect(ping2).toMatchObject({ success: false })
    if (ping2.success) {
      throw new Error('Ping should have failed')
    }
    expect(String(ping2.error)).toMatch(/ECONNRESET/i)

    await client.close()
    await closeServer(server)
  })
})

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function closeServer(server: http.Server | net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
}

async function createHTTPServer(
  cb: (req: http.IncomingMessage, res: http.ServerResponse) => void,
  port: number = 0,
): Promise<[http.Server, number]> {
  const server = http.createServer(cb)
  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })
  return [server, (server.address() as AddressInfo).port]
}

async function createTCPServer(
  cb: (socket: net.Socket) => void,
  port: number = 0,
): Promise<[net.Server, number]> {
  const server = net.createServer(cb)
  await new Promise<void>((resolve) => {
    server.listen(port, () => resolve())
  })
  return [server, (server.address() as AddressInfo).port]
}

async function drainSocket(socket: net.Socket): Promise<void> {
  for await (const chunk of socket) {
    console.log('Received from socket:', chunk.toString())
  }
}
