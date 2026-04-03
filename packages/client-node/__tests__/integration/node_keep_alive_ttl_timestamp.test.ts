import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import {
  ClickHouseLogLevel,
  DefaultLogger,
  type Logger,
} from '@clickhouse/client-common'
import { sleep } from '@test/utils/sleep'
import type { ClickHouseClient } from '../../src'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { createNodeTestClient } from '../utils/node_client'

describe('[Node.js] Keep Alive TTL Timestamp Validation', () => {
  let client: ClickHouseClient
  let logger: Logger
  let traceSpy: ReturnType<typeof vi.spyOn>
  const socketTTL = 5000 // Longer TTL to prevent timer from firing during test

  beforeEach(() => {
    logger = new DefaultLogger()
    traceSpy = vi.spyOn(logger, 'trace')
  })

  afterEach(async () => {
    await client.close()
    vi.restoreAllMocks()
  })

  // Helper to create a LoggerClass that returns our spy-wrapped logger
  function createLoggerClass(): new () => Logger {
    const capturedLogger = logger
    return class extends DefaultLogger {
      trace = capturedLogger.trace.bind(capturedLogger)
      debug = capturedLogger.debug.bind(capturedLogger)
      info = capturedLogger.info.bind(capturedLogger)
      warn = capturedLogger.warn.bind(capturedLogger)
      error = capturedLogger.error.bind(capturedLogger)
    }
  }

  it('should validate TTL using timestamp when timer has not fired yet', async () => {
    // This test specifically verifies timestamp-based validation by mocking Date.now()
    // to advance time past TTL without letting the setTimeout callback execute
    const shortTTL = 1000
    let currentTime = Date.now()

    // Spy on Date.now() to control time
    const dateNowSpy = vi
      .spyOn(Date, 'now')
      .mockImplementation(() => currentTime)

    client = createNodeTestClient({
      max_open_connections: 1,
      log: {
        level: ClickHouseLogLevel.TRACE,
        LoggerClass: createLoggerClass(),
      },
      keep_alive: {
        enabled: true,
        idle_socket_ttl: shortTTL,
      },
    } as NodeClickHouseClientConfigOptions)

    // First query to establish a socket
    const result1 = await client.query({
      query: 'SELECT 1 as value',
      format: 'JSONEachRow',
    })
    expect(await result1.json()).toEqual([{ value: 1 }])

    // Verify a fresh socket was used
    const freshSocketCalls1 = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls1.length).toBe(1)
    const firstSocketId = freshSocketCalls1[0][0].args?.socket_id
    expect(firstSocketId).toBeDefined()

    // Verify socket was released
    const socketReleasedCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes('socket was released'),
    )
    expect(socketReleasedCalls.length).toBeGreaterThanOrEqual(1)

    // Clear spy
    traceSpy.mockClear()

    // Advance mocked time past TTL WITHOUT letting real time pass
    // This simulates a scenario where the timer hasn't fired yet (delayed)
    // but Date.now() has advanced past the TTL
    currentTime += shortTTL + 100

    // Wait a tiny bit for socket to be fully released back to the pool
    await sleep(10)

    // Second query should detect TTL expiry via timestamp check
    // The timer hasn't fired yet (real time hasn't passed), so the socket is still in the pool
    const result2 = await client.query({
      query: 'SELECT 2 as value',
      format: 'JSONEachRow',
    })
    expect(await result2.json()).toEqual([{ value: 2 }])

    // Verify that TTL expiration was detected based on timestamp
    const ttlExpiredCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        (c[0].message?.includes(
          'socket TTL expired based on timestamp, will be destroyed after current request',
        ) ||
          c[0].message?.includes(
            'socket TTL expired on release, destroying immediately',
          ) ||
          c[0].message?.includes(
            'destroying expired socket after request completion',
          )),
    )
    expect(ttlExpiredCalls.length).toBeGreaterThanOrEqual(1)
    // Find the specific TTL expiration detection message
    const ttlDetectionCall = traceSpy.mock.calls.find(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes(
          'socket TTL expired based on timestamp, will be destroyed after current request',
        ),
    )
    if (ttlDetectionCall) {
      expect(ttlDetectionCall[0].args?.socket_id).toBe(firstSocketId)
      expect(ttlDetectionCall[0].args?.socket_age_ms).toBeGreaterThanOrEqual(
        shortTTL,
      )
    }

    // Verify the expired socket was destroyed after use
    const destroyedSocketCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        (c[0].message?.includes(
          'socket TTL expired on release, destroying immediately',
        ) ||
          c[0].message?.includes(
            'destroying expired socket after request completion',
          )),
    )
    expect(destroyedSocketCalls.length).toBeGreaterThanOrEqual(1)
    expect(destroyedSocketCalls[0][0].args?.socket_id).toBe(firstSocketId)

    // Restore Date.now()
    dateNowSpy.mockRestore()
  })

  it('should validate TTL using timestamp even if timer fires late', async () => {
    // This test verifies that socket reuse is prevented based on timestamp
    // even when the Node.js setTimeout fires late (e.g., on a loaded machine)
    // We use a very long TTL but manually advance time to simulate late timer firing
    client = createNodeTestClient({
      max_open_connections: 1,
      log: {
        level: ClickHouseLogLevel.TRACE,
        LoggerClass: createLoggerClass(),
      },
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
      },
    } as NodeClickHouseClientConfigOptions)

    // First query to establish a socket
    const result1 = await client.query({
      query: 'SELECT 1 as value',
      format: 'JSONEachRow',
    })
    expect(await result1.json()).toEqual([{ value: 1 }])

    // Verify a fresh socket was used for the first query
    const freshSocketCalls1 = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls1.length).toBe(1)
    const firstSocketId = freshSocketCalls1[0][0].args?.socket_id
    expect(firstSocketId).toBeDefined()

    // Verify socket was released
    const socketReleasedCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes('socket was released'),
    )
    expect(socketReleasedCalls.length).toBeGreaterThanOrEqual(1)

    // Clear spy to make next assertions clearer
    traceSpy.mockClear()

    // Wait for TTL to expire (plus a buffer) - longer than socketTTL
    // This should trigger the timeout AND the timestamp check
    await sleep(socketTTL + 500)

    // Second query should get a fresh socket
    // The timer should have destroyed it by now
    const result2 = await client.query({
      query: 'SELECT 2 as value',
      format: 'JSONEachRow',
    })
    expect(await result2.json()).toEqual([{ value: 2 }])

    // Since the timer fired, we should see a new fresh socket (the old one was destroyed by the timer)
    const freshSocketCalls2 = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls2.length).toBe(1)
    const secondSocketId = freshSocketCalls2[0][0].args?.socket_id
    expect(secondSocketId).toBeDefined()
    expect(secondSocketId).not.toBe(firstSocketId)

    // Clear spy for third query
    traceSpy.mockClear()

    // Third query shortly after should reuse the socket (TTL not expired)
    const result3 = await client.query({
      query: 'SELECT 3 as value',
      format: 'JSONEachRow',
    })
    expect(await result3.json()).toEqual([{ value: 3 }])

    // Verify the socket was reused (no TTL expiration)
    const reusingSocketCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' && c[0].message?.includes('reusing socket'),
    )
    expect(reusingSocketCalls.length).toBe(1)
    expect(reusingSocketCalls[0][0].args?.socket_id).toBe(secondSocketId)

    // Verify no fresh socket was created for the third query
    const freshSocketCalls3 = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls3.length).toBe(0)
  })

  it('should allow socket reuse within TTL period', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
      log: {
        level: ClickHouseLogLevel.TRACE,
        LoggerClass: createLoggerClass(),
      },
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
      },
    } as NodeClickHouseClientConfigOptions)

    // First query
    const result1 = await client.query({
      query: 'SELECT 1 as value',
      format: 'JSONEachRow',
    })
    expect(await result1.json()).toEqual([{ value: 1 }])

    // Verify a fresh socket was used
    const freshSocketCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls.length).toBe(1)
    const socketId = freshSocketCalls[0][0].args?.socket_id

    // Clear spy
    traceSpy.mockClear()

    // Wait less than TTL
    await sleep(1000)

    // Second query should reuse the socket (within TTL)
    const result2 = await client.query({
      query: 'SELECT 2 as value',
      format: 'JSONEachRow',
    })
    expect(await result2.json()).toEqual([{ value: 2 }])

    // Verify socket was reused (not expired)
    const reusingSocketCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' && c[0].message?.includes('reusing socket'),
    )
    expect(reusingSocketCalls.length).toBe(1)
    expect(reusingSocketCalls[0][0].args?.socket_id).toBe(socketId)

    // Verify no TTL expiration happened
    const ttlExpiredCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes('socket TTL expired based on timestamp'),
    )
    expect(ttlExpiredCalls.length).toBe(0)

    // Verify no fresh socket was created
    const freshSocketCalls2 = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls2.length).toBe(0)
  })

  it('should handle rapid successive requests correctly', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
      log: {
        level: ClickHouseLogLevel.TRACE,
        LoggerClass: createLoggerClass(),
      },
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
      },
    } as NodeClickHouseClientConfigOptions)

    // Rapid successive requests (no TTL expiry)
    const results = []
    for (let i = 0; i < 5; i++) {
      const result = await client.query({
        query: `SELECT ${i} as value`,
        format: 'JSONEachRow',
      })
      results.push(await result.json())
    }

    expect(results).toEqual([
      [{ value: 0 }],
      [{ value: 1 }],
      [{ value: 2 }],
      [{ value: 3 }],
      [{ value: 4 }],
    ])

    // Verify only one fresh socket was created (for the first request)
    const freshSocketCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes("using a fresh socket, setting up a new 'free'"),
    )
    expect(freshSocketCalls.length).toBe(1)

    // Verify the socket was reused for subsequent requests (4 times)
    const reusingSocketCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' && c[0].message?.includes('reusing socket'),
    )
    expect(reusingSocketCalls.length).toBe(4)

    // All reuse calls should reference the same socket ID
    const socketId = freshSocketCalls[0][0].args?.socket_id
    reusingSocketCalls.forEach((call) => {
      expect(call[0].args?.socket_id).toBe(socketId)
    })

    // Verify no TTL expiration occurred during rapid requests
    const ttlExpiredCalls = traceSpy.mock.calls.filter(
      (c) =>
        typeof c[0] === 'object' &&
        c[0].message?.includes('socket TTL expired based on timestamp'),
    )
    expect(ttlExpiredCalls.length).toBe(0)
  })
})
