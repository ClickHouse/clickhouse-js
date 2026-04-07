/**
 * Minimal fetch client example: Ping
 *
 * This example demonstrates checking server availability with ping.
 * Equivalent to: examples/ping.ts (simplified version)
 */

import { createClient } from './minimal_fetch_client'

async function existingHostPing() {
  const client = createClient({
    url: process.env.CLICKHOUSE_URL, // defaults to 'http://localhost:8123'
    password: process.env.CLICKHOUSE_PASSWORD, // defaults to an empty string
  })
  const pingResult = await client.ping()
  if (pingResult.success) {
    console.info('[ExistingHostPing] Ping to the existing host is successful')
  } else {
    console.error(
      '[ExistingHostPing] Ping expected to succeed, but got:',
      pingResult,
    )
  }
  await client.close()
}

async function nonExistingHostPing() {
  const client = createClient({
    url: 'http://localhost:8100', // non-existing host
    request_timeout: 50, // low request_timeout to speed up the example
  })
  const pingResult = await client.ping()
  if (!pingResult.success) {
    console.info(
      '[NonExistingHostPing] Ping failed as expected:',
      pingResult.error?.message,
    )
  } else {
    console.error(
      '[NonExistingHostPing] Ping expected to fail, but got:',
      pingResult,
    )
  }
  await client.close()
}

await existingHostPing()
await nonExistingHostPing()
