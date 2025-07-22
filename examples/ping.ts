import type { PingResult } from '@clickhouse/client'
import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'
import http from 'http'

/**
 * This example assumes that you have a ClickHouse server running locally
 * (for example, from our root docker-compose.yml file),
 * and your local ports 8100 and 18123 are free.
 *
 * Illustrates various ping operation results and how these might be handled on the application side.
 * Ping might be a useful tool to check if the server is available when the application starts,
 * especially with ClickHouse Cloud, where an instance might be idling and will wake up after a ping.
 */
void (async () => {
  await existingHostPing()
  await nonExistingHostPing()
  await timeoutPing()
})()

async function existingHostPing() {
  const client = createClient({
    url: process.env['CLICKHOUSE_URL'], // defaults to 'http://localhost:8123'
    password: process.env['CLICKHOUSE_PASSWORD'], // defaults to an empty string
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
  // Ping does not throw an error; instead, { success: false; error: Error } is returned.
  const pingResult = await client.ping()
  if (hasConnectionRefusedError(pingResult)) {
    console.info('[NonExistingHostPing] Ping connection refused, as expected')
  } else {
    console.error(
      '[NonExistingHostPing] Ping expected to fail with ECONNREFUSED, but got:',
      pingResult,
    )
  }
  await client.close()
}

// Using a "slow" HTTP server to simulate a ClickHouse server that does not respond to the request in time
async function timeoutPing() {
  const server = startSlowHTTPServer()
  const client = createClient({
    url: 'http://localhost:18123',
    request_timeout: 50, // low request_timeout to speed up the example
  })
  // Ping does not throw an error; instead, { success: false; error: Error } is returned.
  const pingResult = await client.ping()
  server.close()
  // If your application uses ping during its startup, you could retry a failed ping a few times.
  // Maybe it's a transient network issue or, in case of ClickHouse Cloud,
  // the instance is idling and will start waking up after a ping.
  if (hasTimeoutError(pingResult)) {
    console.info('[TimeoutPing] Ping timed out, as expected')
  } else {
    console.error(
      '[TimeoutPing] Ping expected to fail with a timeout error, but got:',
      pingResult,
    )
  }
  await client.close()
}

function startSlowHTTPServer() {
  const server = http.createServer(async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    res.write('Ok.')
    return res.end()
  })
  server.listen(18123)
  return server
}

function hasConnectionRefusedError(
  pingResult: PingResult,
): pingResult is PingResult & { error: { code: 'ECONNREFUSED' } } {
  return (
    !pingResult.success &&
    'code' in pingResult.error &&
    pingResult.error.code === 'ECONNREFUSED'
  )
}

function hasTimeoutError(
  pingResult: PingResult,
): pingResult is PingResult & { error: Error } {
  return (
    !pingResult.success &&
    'message' in pingResult.error &&
    pingResult.error.message.includes('Timeout error')
  )
}
