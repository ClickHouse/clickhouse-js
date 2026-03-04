import { ClickHouseLogLevel, Logger } from '@clickhouse/client-common'
import { describe, it, expect } from 'vitest'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import net from 'net'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { AddressInfo } from 'net'

describe.concurrent('Handling keep-alive header', () => {
  it('should log the suggestion', async ({ expect }) => {
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
        expect.fail('Extra connection attempt - should not happen')
      }
      // Write a valid response
      socket.write(
        'HTTP/1.1 200 OK\r\n' +
          'Content-Type: text/plain\r\n' +
          'Content-Length: 3\r\n' +
          'Connection: Keep-Alive\r\n' +
          'Keep-Alive: timeout=10, max=9999\r\n' +
          '\r\n' +
          'Ok.',
      )
      // Then start the next request
      await sleepServerPromise
      // …and then close the connection before sending anything,
      // to trigger the error in the client
      socket.end()
    })

    const logs: any[] = []
    const LoggerClass = createLoggerClass(logs)

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enable: true,
        idle_socket_ttl: 15000, // bigger than the server's timeout
      },
      log: {
        LoggerClass,
        level: ClickHouseLogLevel.TRACE,
      },
    } as NodeClickHouseClientConfigOptions)

    expect(await client.ping({ select: true })).toMatchObject({ success: true })

    expect(
      findMatchingLogEvents(
        logs,
        /updated server sent socket keep-alive timeout/,
      )?.[0]?.[0],
    ).toMatchObject({
      args: {
        server_keep_alive_timeout_ms: 10000,
      },
    })

    let ping2 = client.ping({ select: true })
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
    expect(ping2.error.code).toMatch(/ECONNRESET/i)
    expect(ping2.error.message).toMatch(/socket hang up/i)

    expect(
      findMatchingLogEvents(
        logs,
        /https:\/\/c.house\/js_keep_alive_econnreset/,
      )?.[0]?.[0],
    ).toMatchObject({
      args: {
        server_keep_alive_timeout_ms: 10000,
      },
    })

    // console.log('!!!!!!!!!!!!!!!!!!!!')
    // console.log(JSON.stringify(logs, null, 2))
    // console.log('!!!!!!!!!!!!!!!!!!!!')

    server.close()
    client.close()
  })

  it('should not log the suggestion', async ({ expect }) => {
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
        expect.fail('Extra connection attempt - should not happen')
      }
      // Write a valid response
      socket.write(
        'HTTP/1.1 200 OK\r\n' +
          'Content-Type: text/plain\r\n' +
          'Content-Length: 3\r\n' +
          'Connection: Keep-Alive\r\n' +
          'Keep-Alive: timeout=10, max=9999\r\n' +
          '\r\n' +
          'Ok.',
      )
      // Then start the next request
      await sleepServerPromise
      // …and then close the connection before sending anything,
      // to trigger the error in the client
      socket.end()
    })

    const logs: any[] = []
    const LoggerClass = createLoggerClass(logs)

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enable: true,
        idle_socket_ttl: 5000, // smaller than the server's timeout
      },
      log: {
        LoggerClass,
        level: ClickHouseLogLevel.TRACE,
      },
    } as NodeClickHouseClientConfigOptions)

    expect(await client.ping({ select: true })).toMatchObject({ success: true })

    expect(
      findMatchingLogEvents(
        logs,
        /updated server sent socket keep-alive timeout/,
      )?.[0]?.[0],
    ).toMatchObject({
      args: {
        server_keep_alive_timeout_ms: 10000,
      },
    })

    let ping2 = client.ping({ select: true })
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
    expect(ping2.error.code).toMatch(/ECONNRESET/i)
    expect(ping2.error.message).toMatch(/socket hang up/i)

    expect(
      findMatchingLogEvents(
        logs,
        /https:\/\/c.house\/js_keep_alive_econnreset/,
      )?.[0]?.[0],
    ).toBeUndefined()

    server.close()
    client.close()
  })
})

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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

function findMatchingLogEvents<T>(logs: T[], regex: RegExp): T[] {
  return logs.filter((args) => regex.test(JSON.stringify(args)))
}
