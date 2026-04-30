import type { PingResult } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'
import http from 'http' // Node.js only

/**
 * Node.js-only example.
 *
 * This example assumes that your local port 18123 is free.
 *
 * Illustrates ping behaviour against a server that is too slow to respond within `request_timeout`.
 * A "slow" HTTP server is started locally with Node's `http` module to simulate a
 * ClickHouse server that does not respond in time, so this example cannot run in a
 * browser/Web environment.
 *
 * If your application uses ping during its startup, you could retry a failed ping a few times.
 * Maybe it's a transient network issue or, in case of ClickHouse Cloud,
 * the instance is idling and will start waking up after a ping.
 *
 * See also:
 *  - `ping_existing_host.ts`     - successful ping against an existing host.
 *  - `ping_non_existing_host.ts` - ping against a host that does not exist.
 */
const server = await startSlowHTTPServer()
const client = createClient({
  url: 'http://localhost:18123',
  request_timeout: 50, // low request_timeout to speed up the example
})
// Ping does not throw an error; instead, { success: false; error: Error } is returned.
const pingResult = await client.ping()
server.close()
if (hasTimeoutError(pingResult)) {
  console.info('[TimeoutPing] Ping timed out, as expected')
} else {
  console.error(
    '[TimeoutPing] Ping expected to fail with a timeout error, but got:',
    pingResult,
  )
}
await client.close()

// Wait until the server is actually listening before returning;
// otherwise the ping below could race and yield ECONNREFUSED instead of a timeout.
async function startSlowHTTPServer() {
  const server = http.createServer(async (_req, res) => {
    await new Promise((resolve) => setTimeout(resolve, 100))
    res.write('Ok.')
    return res.end()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve())
    server.once('error', reject)
    server.listen(18123)
  })
  return server
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
