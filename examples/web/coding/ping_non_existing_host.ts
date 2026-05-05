// This example assumes that your local port 8100 is free.
//
// Illustrates ping behaviour against a non-existing host: ping does not throw,
// instead it returns `{ success: false; error: Error }`. This can be useful when checking
// server availability on application startup.
//
// Note: in browser runtimes, network errors from `fetch` are typically opaque
// and do not expose Node-style error codes such as `ECONNREFUSED`. This example
// therefore only checks `success === false` and logs `pingResult.error`, rather
// than relying on a specific error code.
//
// See also:
//  - `ping_existing_host.ts` - successful ping against an existing host.
//  - `ping_timeout.ts`       - ping that times out.
import { createClient } from '@clickhouse/client-web'

const client = createClient({
  url: 'http://localhost:8100', // non-existing host
  request_timeout: 50, // low request_timeout to speed up the example
})
// Ping does not throw an error; instead, { success: false; error: Error } is returned.
const pingResult = await client.ping()
if (!pingResult.success) {
  console.info(
    '[NonExistingHostPing] Ping failed as expected:',
    pingResult.error,
  )
} else {
  console.error(
    '[NonExistingHostPing] Ping was expected to fail, but it succeeded',
  )
}
await client.close()
