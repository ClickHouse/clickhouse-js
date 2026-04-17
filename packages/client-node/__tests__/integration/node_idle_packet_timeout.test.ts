import type { ClickHouseClient } from '@clickhouse/client-common'
import { describe, it, beforeAll, afterAll, expect } from 'vitest'
import { createTestClient } from '@test/utils/client'
import * as http from 'http'
import type Stream from 'stream'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { AddressInfo } from 'net'

describe('Idle packet timeout', () => {
  it('should timeout when no data is received for idle_packet_timeout duration', async () => {
    let headersSent = false
    // Simulate a server that sends headers but then stops sending data
    const [server, port] = await createHTTPServer(async (req, res) => {
      // Send headers immediately
      res.writeHead(200, {
        'Content-Type': 'text/plain',
        'Transfer-Encoding': 'chunked',
      })
      headersSent = true
      // Don't send any body data - simulate LB idle timeout scenario
      // The connection stays open but no data flows
    })

    // Client has idle_packet_timeout set to a short duration for testing
    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: 10_000, // 10 seconds - longer than idle timeout
      idle_packet_timeout: 100, // 100ms - short for testing
      keep_alive: {
        enabled: true,
      },
    } as NodeClickHouseClientConfigOptions)

    const startTime = Date.now()
    await expect(
      client.query({ query: 'SELECT 1' }).then((rs) => rs.text()),
    ).rejects.toThrow(/Idle packet timeout/)

    const duration = Date.now() - startTime
    // Should timeout around 100ms, not 10 seconds
    expect(duration).toBeLessThan(1000)
    expect(duration).toBeGreaterThanOrEqual(100)
    expect(headersSent).toBe(true)

    await client.close()
    await closeServer(server)
  })

  it('should not timeout when data is continuously received', async () => {
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
    } as NodeClickHouseClientConfigOptions)

    // Should succeed because data is received every 50ms
    const rs = await client.query({ query: 'SELECT 1' })
    const text = await rs.text()
    expect(text).toContain('chunk0')
    expect(text).toContain('chunk4')

    await client.close()
    await closeServer(server)
  })

  it('should respect idle_packet_timeout=0 to disable the check', async () => {
    // Simulate a server that sends headers but no body
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
    } as NodeClickHouseClientConfigOptions)

    // Should succeed even though no data for 200ms
    const rs = await client.query({ query: 'SELECT 1' })
    const text = await rs.text()
    expect(text).toBe('delayed response')

    await client.close()
    await closeServer(server)
  })

  it('should timeout on initial response delay', async () => {
    // Simulate a server that never sends headers
    const [server, port] = await createHTTPServer(async (req, res) => {
      // Never respond - simulate complete stall
      await new Promise(() => {}) // Never resolves
    })

    const client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      request_timeout: 10_000,
      idle_packet_timeout: 100,
      keep_alive: {
        enabled: true,
      },
    } as NodeClickHouseClientConfigOptions)

    const startTime = Date.now()
    await expect(
      client.query({ query: 'SELECT 1' }).then((rs) => rs.text()),
    ).rejects.toThrow(/Timeout error/) // Request timeout, not idle packet timeout

    const duration = Date.now() - startTime
    // Should use request_timeout since we never got headers
    expect(duration).toBeGreaterThanOrEqual(100)
    expect(duration).toBeLessThan(1000)

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
