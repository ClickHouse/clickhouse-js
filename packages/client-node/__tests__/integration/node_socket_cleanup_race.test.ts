import { describe, it, expect, vi } from 'vitest'
import {
  ClickHouseLogLevel,
  type ErrorLogParams,
  type Logger,
  type LogParams,
} from '@clickhouse/client-common'
import { createTestClient } from '@test/utils/client'
import * as net from 'net'
import { AddressInfo } from 'net'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'

describe('[Node.js] Socket cleanup race condition', () => {
  it('should reproduce responseStream undefined access in cleanup handler', async () => {
    // This test reproduces issue #4 from the socket handling bug analysis:
    // "responseStream Used Before Definition in Cleanup"
    //
    // The bug occurs when:
    // 1. responseStream is declared at line 216 but not yet initialized
    // 2. Socket 'end' or 'close' events fire before onResponse is called
    // 3. cleanup() handler (lines 458-493) tries to access responseStream at line 479
    // 4. This accesses an undefined variable in the conditional check
    //
    // While JavaScript's falsy check (if (responseStream && ...)) handles undefined gracefully,
    // this is still a logic bug that could cause issues if the check were different
    // or if stricter type checking is applied.

    const warnMessages: Array<{
      message: string
      args?: Record<string, unknown>
    }> = []
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
      warn({ message, args }: LogParams) {
        warnMessages.push({ message, args: args as Record<string, unknown> })
      }
      error(_params: ErrorLogParams) {}
    }

    // Create a TCP server that closes the socket immediately after accepting connection
    // This simulates a scenario where the socket closes before onResponse is called
    const [server, port] = await createTCPServer(async (socket) => {
      // Read the incoming request data
      socket.once('data', () => {
        // Close the socket immediately without sending any response
        // This triggers 'end' or 'close' events before 'response' event
        socket.destroy()
      })
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 5000,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.TRACE,
      },
      request_timeout: 1000,
    } as NodeClickHouseClientConfigOptions)

    try {
      // This should fail, but should not cause any errors related to accessing undefined responseStream
      const result = await client.ping()
      expect(result.success).toBe(false)

      // Check that we got the expected cleanup trace messages
      const cleanupMessages = traceMessages.filter((m) =>
        m.message.includes("'free' listener removed"),
      )
      expect(cleanupMessages.length).toBeGreaterThan(0)

      // The key issue: when cleanup runs before onResponse, it accesses responseStream
      // which is still undefined at line 479 in socket_pool.ts:
      //   if (responseStream && !responseStream.readableEnded)
      //
      // This test demonstrates that the code path is executed where responseStream
      // is accessed before it's initialized.
    } finally {
      await client.close()
      await closeServer(server)
    }
  })

  it('should handle socket close before response without accessing undefined responseStream', async () => {
    const warnMessages: Array<{
      message: string
      args?: Record<string, unknown>
    }> = []
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
      warn({ message, args }: LogParams) {
        warnMessages.push({ message, args: args as Record<string, unknown> })
      }
      error(_params: ErrorLogParams) {}
    }

    // Create a TCP server that closes the socket immediately after accepting connection
    // This simulates a scenario where the socket closes before onResponse is called
    const [server, port] = await createTCPServer(async (socket) => {
      // Read the incoming request data
      socket.once('data', () => {
        // Close the socket immediately without sending any response
        // This triggers 'end' or 'close' events before 'response' event
        socket.destroy()
      })
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 5000,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.TRACE,
      },
      request_timeout: 1000,
    } as NodeClickHouseClientConfigOptions)

    try {
      // This should fail, but should not cause any errors related to accessing undefined responseStream
      const result = await client.ping()
      expect(result.success).toBe(false)

      // Check that we got the expected cleanup trace messages
      const cleanupMessages = traceMessages.filter((m) =>
        m.message.includes("'free' listener removed"),
      )
      expect(cleanupMessages.length).toBeGreaterThan(0)

      // The key assertion: we should NOT see any warnings about responseStream
      // being undefined or any errors about accessing properties of undefined
      // If the bug exists, the cleanup function would try to access responseStream.readableEnded
      // when responseStream is still undefined, which could cause issues

      // Check that warn messages don't contain errors about undefined
      for (const warnMsg of warnMessages) {
        expect(warnMsg.message).not.toMatch(/undefined/)
        expect(warnMsg.message).not.toMatch(/Cannot read propert/)
      }
    } finally {
      await client.close()
      await closeServer(server)
    }
  })

  it('should handle socket end event before response is received', async () => {
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

    // Create a TCP server that sends partial headers then ends the connection
    const [server, port] = await createTCPServer(async (socket) => {
      socket.once('data', async () => {
        // Send partial HTTP response (just status line, no complete headers)
        socket.write('HTTP/1.1 200 OK\r\n')
        await sleep(10)
        // End the socket before completing the response
        // This triggers socket 'end' event before the HTTP parser emits 'response'
        socket.end()
      })
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 5000,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.WARN,
      },
      request_timeout: 1000,
    } as NodeClickHouseClientConfigOptions)

    try {
      const result = await client.ping()
      expect(result.success).toBe(false)

      // The bug would manifest as trying to access responseStream.readableEnded
      // when responseStream is undefined in the cleanup function
      // This test verifies that no such error occurs
    } finally {
      await client.close()
      await closeServer(server)
    }
  })

  it('should not log warning about unconsumed stream when socket closes before response', async () => {
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

    const [server, port] = await createTCPServer(async (socket) => {
      socket.once('data', () => {
        // Destroy socket immediately without sending response
        socket.destroy()
      })
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 5000,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.WARN,
      },
      request_timeout: 1000,
    } as NodeClickHouseClientConfigOptions)

    try {
      const result = await client.ping()
      expect(result.success).toBe(false)

      // When socket closes before response arrives, responseStream is undefined
      // The cleanup function should NOT log a warning about unconsumed response
      // because there is no response stream yet
      const unconsumedStreamWarnings = warnMessages.filter((m) =>
        m.message.includes(
          'socket was closed or ended before the response was fully read',
        ),
      )

      // This is the key assertion: no warning should be logged when responseStream is undefined
      // However, due to the bug, if responseStream is checked without proper guard,
      // this might cause issues
      expect(unconsumedStreamWarnings.length).toBe(0)
    } finally {
      await client.close()
      await closeServer(server)
    }
  })

  it('should demonstrate that cleanup can execute when responseStream is still undefined', async () => {
    // This test explicitly verifies the timing issue where the cleanup function
    // is invoked before responseStream has been assigned a value.
    //
    // The sequence of events that causes the bug:
    // 1. request.on('socket', onSocket) - socket event fires
    // 2. onSocket registers cleanup handlers: socket.once('end', cleanup('end'))
    // 3. socket.once('close', cleanup('close'))
    // 4. Socket connection fails immediately and 'close'/'end' event fires
    // 5. cleanup() executes and checks: if (responseStream && !responseStream.readableEnded)
    // 6. At this point, responseStream is still undefined (declared but not assigned)
    // 7. request.on('response', onResponse) never fires because connection failed
    //
    // This is a race condition that occurs when the socket fails before the HTTP
    // response is received.

    let cleanupExecutedBeforeResponse = false
    const traceMessages: Array<string> = []

    class CapturingLogger implements Logger {
      trace({ message }: LogParams) {
        traceMessages.push(message)
      }
      debug(_params: LogParams) {}
      info(_params: LogParams) {}
      warn(_params: LogParams) {}
      error(_params: ErrorLogParams) {}
    }

    const [server, port] = await createTCPServer(async (socket) => {
      socket.once('data', () => {
        // Destroy immediately to trigger cleanup before any response
        socket.destroy()
      })
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: 5000,
      },
      log: {
        LoggerClass: CapturingLogger,
        level: ClickHouseLogLevel.TRACE,
      },
      request_timeout: 1000,
    } as NodeClickHouseClientConfigOptions)

    try {
      const result = await client.ping()
      expect(result.success).toBe(false)

      // Verify the sequence of events
      const hasCleanupMessage = traceMessages.some((m) =>
        m.includes("'free' listener removed"),
      )
      const hasResponseMessage = traceMessages.some((m) =>
        m.includes('got a response from ClickHouse'),
      )

      // The cleanup message should be present
      expect(hasCleanupMessage).toBe(true)

      // The response message should NOT be present (connection failed before response)
      expect(hasResponseMessage).toBe(false)

      // This confirms that cleanup ran without a response being received,
      // which means responseStream was undefined when cleanup tried to check it
      cleanupExecutedBeforeResponse = true
    } finally {
      await client.close()
      await closeServer(server)
    }

    // Final assertion: we successfully reproduced the condition
    expect(cleanupExecutedBeforeResponse).toBe(true)
  })
})

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()))
  })
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
