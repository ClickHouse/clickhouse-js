import type { Logger } from '@clickhouse/client-common'
import { describe, it, expect } from 'vitest'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import net from 'net'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { AddressInfo } from 'net'

describe.concurrent('Handling keep-alive header', () => {
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

const createLoggerClass = (logs: any[]) =>
  class TestLogger implements Logger {
    trace(...args: any) {
      logs.push(args)
    }
    debug(...args: any) {
      logs.push(args)
    }
    info(...args: any) {
      logs.push(args)
    }
    warn(...args: any) {
      logs.push(args)
    }
    error(...args: any) {
      logs.push(args)
    }
  }
