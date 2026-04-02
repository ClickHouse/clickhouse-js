import { describe, it, expect, afterEach, vi } from 'vitest'
import { ClickHouseLogLevel } from '@clickhouse/client-common'
import { sleep } from '@test/utils/sleep'
import type { ClickHouseClient } from '../../src'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { createNodeTestClient } from '../utils/node_client'

describe('[Node.js] Keep Alive TTL Timestamp Validation', () => {
  let client: ClickHouseClient
  const socketTTL = 1000 // Short TTL for testing

  afterEach(async () => {
    await client.close()
    vi.restoreAllMocks()
  })

  it('should validate TTL using timestamp even if timer fires late', async () => {
    // This test verifies that socket reuse is prevented based on timestamp
    // even when the Node.js setTimeout fires late (e.g., on a loaded machine)
    client = createNodeTestClient({
      max_open_connections: 1,
      log: {
        level: ClickHouseLogLevel.TRACE,
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

    // Wait for TTL to expire (plus a small buffer)
    await sleep(socketTTL + 100)

    // Second query should get a fresh socket due to timestamp validation
    // Even if the timer hasn't fired yet, the timestamp check should prevent reuse
    const result2 = await client.query({
      query: 'SELECT 2 as value',
      format: 'JSONEachRow',
    })
    expect(await result2.json()).toEqual([{ value: 2 }])

    // Third query shortly after should reuse the socket (TTL not expired)
    const result3 = await client.query({
      query: 'SELECT 3 as value',
      format: 'JSONEachRow',
    })
    expect(await result3.json()).toEqual([{ value: 3 }])
  })

  it('should allow socket reuse within TTL period', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
      log: {
        level: ClickHouseLogLevel.TRACE,
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

    // Wait less than TTL
    await sleep(socketTTL / 2)

    // Second query should reuse the socket (within TTL)
    const result2 = await client.query({
      query: 'SELECT 2 as value',
      format: 'JSONEachRow',
    })
    expect(await result2.json()).toEqual([{ value: 2 }])
  })

  it('should handle rapid successive requests correctly', async () => {
    client = createNodeTestClient({
      max_open_connections: 1,
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
  })
})
