import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  ClickHouseLogLevel,
  type ErrorLogParams,
  type Logger,
  type LogParams,
} from '@clickhouse/client-common'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import { AddressInfo } from 'net'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'

describe('[Node.js] Eager socket destruction', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should destroy a stale socket and emit a TRACE log when eagerly_destroy_stale_sockets is true', async () => {
    // A very long TTL so that the idle timer does not fire during the test.
    // This ensures the socket stays in `freeSockets` until we manually trigger
    // the eager-destroy logic by mocking Date.now() to a future time.
    const socketTTL = 60_000

    const traceMessages: Array<{
      message: string
      args?: Record<string, unknown>
    }> = []

    class CapturingLogger implements Logger {
      trace({ message, args }: LogParams) {
        traceMessages.push({ message, args: args as Record<string, unknown> })
      }
      debug(_params: LogParams) {}
      info(_params: LogParams) {}
      warn(_params: LogParams) {}
      error(_params: ErrorLogParams) {}
    }

    const [server, port] = await createHTTPServer((_req, res) => {
      res.write('Ok.')
      res.end()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
        eagerly_destroy_stale_sockets: true,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.TRACE,
      },
    } as NodeClickHouseClientConfigOptions)

    try {
      // Capture the current timestamp before the first request so that
      // futureNow is computed from a stable baseline rather than from
      // whatever Date.now() returns after the async sleep completes.
      const baseNow = Date.now()

      // First ping establishes the socket and, once the response is consumed,
      // returns it to agent.freeSockets with freed_at_timestamp_ms = Date.now().
      await client.ping()

      // Small delay to ensure the 'free' event has fired and the socket is
      // back in agent.freeSockets before the next request is sent.
      await sleep(50)

      // Simulate passage of time beyond the TTL so the eager-destroy loop
      // considers the free socket to be stale. Using a constant mock so that
      // the idle timer (which only fires after socketTTL real milliseconds)
      // has no chance to fire and destroy the socket first.
      const futureNow = baseNow + socketTTL + 100
      vi.spyOn(Date, 'now').mockReturnValue(futureNow)

      // Second ping triggers the eager-destroy pre-request loop.
      await client.ping()

      const destroyLogs = traceMessages.filter((m) =>
        m.message.includes(
          'socket TTL expired based on timestamp, destroying socket',
        ),
      )
      expect(destroyLogs.length).toBeGreaterThan(0)
      expect(destroyLogs[0].args).toMatchObject({
        socket_age_ms: expect.any(Number),
        idle_socket_ttl_ms: socketTTL,
      })
    } finally {
      await client.close()
      await closeServer(server)
    }
  })

  it('should emit a WARN log when reusing a socket whose TTL has expired by timestamp', async () => {
    // A very long TTL so that the idle timer does not fire during the test.
    const socketTTL = 60_000

    const warnMessages: Array<{
      message: string
      args?: Record<string, unknown>
    }> = []

    class CapturingLogger implements Logger {
      trace(_params: LogParams) {}
      debug(_params: LogParams) {}
      info(_params: LogParams) {}
      warn({ message, args }: LogParams) {
        warnMessages.push({ message, args: args as Record<string, unknown> })
      }
      error(_params: ErrorLogParams) {}
    }

    const [server, port] = await createHTTPServer((_req, res) => {
      res.write('Ok.')
      res.end()
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
        // Eager destruction is disabled; stale socket should be reused with a WARN.
        eagerly_destroy_stale_sockets: false,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.WARN,
      },
    } as NodeClickHouseClientConfigOptions)

    try {
      // Capture the current timestamp before the first request so that
      // futureNow is computed from a stable baseline rather than from
      // whatever Date.now() returns after the async sleep completes.
      const baseNow = Date.now()

      // First ping establishes the socket and returns it to freeSockets.
      await client.ping()

      // Small delay to ensure the socket is back in agent.freeSockets.
      await sleep(50)

      // Simulate passage of time beyond the TTL so the WARN log fires when
      // the reuse path checks freed_at_timestamp_ms.
      const futureNow = baseNow + socketTTL + 100
      vi.spyOn(Date, 'now').mockReturnValue(futureNow)

      // Second ping reuses the stale socket (eager destroy is off) and should
      // emit a WARN to alert the user of the situation.
      await client.ping()

      const staleReuseWarnings = warnMessages.filter((m) =>
        m.message.includes(
          'reusing socket with TTL expired based on timestamp',
        ),
      )
      expect(staleReuseWarnings.length).toBeGreaterThan(0)
      expect(staleReuseWarnings[0].args).toMatchObject({
        socket_age_ms: expect.any(Number),
        idle_socket_ttl_ms: socketTTL,
      })
    } finally {
      await client.close()
      await closeServer(server)
    }
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
): Promise<[http.Server, number]> {
  const server = http.createServer(cb)
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve())
  })
  return [server, (server.address() as AddressInfo).port]
}
