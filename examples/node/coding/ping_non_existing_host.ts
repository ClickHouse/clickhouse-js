// This example assumes that your local port 8100 is free.
//
// Illustrates ping behaviour against a non-existing host: ping does not throw,
// instead it returns `{ success: false; error: Error }`. This can be useful when checking
// server availability on application startup.
//
// See also:
//  - `ping_existing_host.ts` - successful ping against an existing host.
//  - `ping_timeout.ts`       - ping that times out.
import type { PingResult } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'

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

function hasConnectionRefusedError(
  pingResult: PingResult,
): pingResult is PingResult & { error: { code: 'ECONNREFUSED' } } {
  return (
    !pingResult.success &&
    'code' in pingResult.error &&
    pingResult.error.code === 'ECONNREFUSED'
  )
}
