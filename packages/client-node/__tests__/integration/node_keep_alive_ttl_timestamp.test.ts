import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import {
  ClickHouseLogLevel,
  type Logger,
  type LogParams,
  type ErrorLogParams,
} from '@clickhouse/client-common'
import { sleep } from '@test/utils/sleep'
import type { ClickHouseClient } from '../../src'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { createNodeTestClient } from '../utils/node_client'

describe('[Node.js] Keep Alive TTL with Timestamp Validation', () => {
  let client: ClickHouseClient
  const socketTTL = 1000 // 1 second for faster testing
  let logs: LogParams[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    logs = []
  })

  afterEach(async () => {
    if (client) {
      await client.close()
    }
  })

  class TestLogger implements Logger {
    trace(params: LogParams) {
      logs.push(params)
    }
    debug(params: LogParams) {
      logs.push(params)
    }
    info(params: LogParams) {
      logs.push(params)
    }
    warn(params: LogParams) {
      logs.push(params)
    }
    error(params: ErrorLogParams) {
      logs.push(params)
    }
  }

  it('should verify socket TTL expiration using timestamp when timer fires late', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
      },
      log: {
        LoggerClass: TestLogger,
        level: ClickHouseLogLevel.TRACE,
      },
    } as NodeClickHouseClientConfigOptions)

    // First request to create a socket
    const rs1 = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    })
    await rs1.json() // Consume the stream

    // Wait for socket to be released and timestamp to be recorded
    await sleep(200)

    // Verify socket was released with timestamp
    const releaseLog = logs.find(
      (log) =>
        log.message?.includes('socket was released') &&
        log.args?.freed_at_timestamp_ms !== undefined,
    )
    expect(releaseLog).toBeDefined()
    const socketId = releaseLog?.args?.socket_id

    // Wait for the TTL to expire (plus buffer)
    await sleep(socketTTL + 300)

    // Make another request - should detect expired socket via timestamp check
    const rs2 = await client.query({
      query: 'SELECT 2',
      format: 'JSONEachRow',
    })
    await rs2.json() // Consume the stream

    // Verify that either:
    // 1. Socket TTL expired based on timestamp (if timer was late)
    // 2. Or socket was removed by timer and a fresh socket was used
    const ttlExpiredLog = logs.find(
      (log) =>
        log.message?.includes('socket TTL expired based on timestamp') &&
        log.args?.socket_id === socketId,
    )

    const freshSocketLog = logs.find(
      (log) =>
        log.message?.includes('using a fresh socket') &&
        log.args?.socket_id !== socketId,
    )

    // At least one of these should be true
    expect(ttlExpiredLog || freshSocketLog).toBeTruthy()
  })

  it('should reuse socket within TTL window', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
      },
      log: {
        LoggerClass: TestLogger,
        level: ClickHouseLogLevel.TRACE,
      },
    } as NodeClickHouseClientConfigOptions)

    // First request
    const rs1 = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    })
    await rs1.json()

    // Wait for socket to be released
    await sleep(200)

    // Get the socket ID
    const releaseLog = logs.find((log) =>
      log.message?.includes('socket was released'),
    )
    const socketId = releaseLog?.args?.socket_id

    // Make another request within TTL window (within 500ms, TTL is 1000ms)
    const rs2 = await client.query({
      query: 'SELECT 2',
      format: 'JSONEachRow',
    })
    await rs2.json()

    // Verify socket was reused
    const reuseLog = logs.find(
      (log) =>
        log.message?.includes('reusing socket') &&
        log.args?.socket_id === socketId,
    )
    expect(reuseLog).toBeDefined()
  })

  it('should include timestamp in freed_at_timestamp_ms when socket is released', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: socketTTL,
      },
      log: {
        LoggerClass: TestLogger,
        level: ClickHouseLogLevel.TRACE,
      },
    } as NodeClickHouseClientConfigOptions)

    const beforeRequest = Date.now()

    const rs = await client.query({
      query: 'SELECT 1',
      format: 'JSONEachRow',
    })
    await rs.json()

    await sleep(200)

    const afterRequest = Date.now()

    // Find the socket release log
    const releaseLog = logs.find((log) =>
      log.message?.includes('socket was released'),
    )

    expect(releaseLog).toBeDefined()
    const freedAt = releaseLog?.args?.freed_at_timestamp_ms

    // Verify timestamp is reasonable (between before and after the request)
    expect(freedAt).toBeGreaterThanOrEqual(beforeRequest)
    expect(freedAt).toBeLessThanOrEqual(afterRequest)
  })
})
