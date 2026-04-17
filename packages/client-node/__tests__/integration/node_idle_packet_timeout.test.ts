import type { ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeAll, afterAll, expect, vi } from 'vitest'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { AddressInfo } from 'net'
import { ClickHouseLogLevel } from '@clickhouse/client-common'

describe('Idle packet timeout warnings', () => {
  it('should warn when no data is received for idle_packet_timeout duration', async () => {
    const warnSpy = vi.fn()

    // Simulate a server that sends headers but then stops sending data
    const [server, port] = await createHTTPServer(async (req, res) => {
      // Send headers immediately
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
      })
      // Send some data initially
      res.write('initial data\n')
      // Then stop sending data for a while
      await sleep(150)
      // Finally send more data and end
      res.write('final data\n')
      res.end()
    })

    // Client has idle_packet_timeout set to a short duration for testing
    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: 10_000, // 10 seconds - longer than idle timeout
      idle_packet_timeout: 100, // 100ms - short for testing
      keep_alive: {
        enabled: true,
      },
      log: {
        level: ClickHouseLogLevel.WARN,
        LoggerClass: class {
          trace() {}
          debug() {}
          info() {}
          warn(args: any) {
            warnSpy(args)
          }
          error() {}
        },
      },
    } as NodeClickHouseClientConfigOptions)

    // Should succeed and emit a warning
    const rs = await client.query({ query: 'SELECT 1' })
    const text = await rs.text()
    expect(text).toContain('initial data')
    expect(text).toContain('final data')

    // Should have emitted a warning about no data received
    expect(warnSpy).toHaveBeenCalled()
    const warningCall = warnSpy.mock.calls.find((call) =>
      call[0].message?.includes('no data received from the server'),
    )
    expect(warningCall).toBeDefined()
    expect(warningCall[0].message).toContain(
      'might be dropped by a load balancer',
    )

    await client.close()
    await closeServer(server)
  })

  it('should not warn when data is continuously received', async () => {
    const warnSpy = vi.fn()

    // Simulate a server that sends data in chunks with delays
    const [server, port] = await createHTTPServer(async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
      })

      // Send data in multiple chunks with delays between them
      for (let i = 0; i < 5; i++) {
        res.write(`chunk${i}\n`)
        // Wait 50ms between chunks (less than idle_packet_timeout)
        await sleep(50)
      }

      res.end()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: 10_000,
      idle_packet_timeout: 100, // 100ms timeout
      keep_alive: {
        enabled: true,
      },
      log: {
        level: ClickHouseLogLevel.WARN,
        LoggerClass: class {
          trace() {}
          debug() {}
          info() {}
          warn(args: any) {
            warnSpy(args)
          }
          error() {}
        },
      },
    } as NodeClickHouseClientConfigOptions)

    // Should succeed without warnings
    const rs = await client.query({ query: 'SELECT 1' })
    const text = await rs.text()
    expect(text).toContain('chunk0')
    expect(text).toContain('chunk4')

    // Should not have emitted any idle packet warnings
    const idleWarning = warnSpy.mock.calls.find((call) =>
      call[0].message?.includes('no data received from the server'),
    )
    expect(idleWarning).toBeUndefined()

    await client.close()
    await closeServer(server)
  })

  it('should respect idle_packet_timeout=0 to disable the check', async () => {
    const warnSpy = vi.fn()

    // Simulate a server that sends headers but no body for a while
    const [server, port] = await createHTTPServer(async (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/plain',
      })
      // Don't send any data for 200ms
      await sleep(200)
      res.end('delayed response')
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: 10_000,
      idle_packet_timeout: 0, // Disabled
      keep_alive: {
        enabled: true,
      },
      log: {
        level: ClickHouseLogLevel.WARN,
        LoggerClass: class {
          trace() {}
          debug() {}
          info() {}
          warn(args: any) {
            warnSpy(args)
          }
          error() {}
        },
      },
    } as NodeClickHouseClientConfigOptions)

    // Should succeed without warnings even though no data for 200ms
    const rs = await client.query({ query: 'SELECT 1' })
    const text = await rs.text()
    expect(text).toBe('delayed response')

    // Should not have emitted any warnings
    expect(warnSpy).not.toHaveBeenCalled()

    await client.close()
    await closeServer(server)
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
