// This example assumes that you have a ClickHouse server running locally
// (for example, from our root docker-compose.yml file).
//
// Illustrates a successful ping against an existing host and how it might be handled on the application side.
// Ping might be a useful tool to check if the server is available when the application starts,
// especially with ClickHouse Cloud, where an instance might be idling and will wake up after a ping.
//
// See also:
//  - `ping_non_existing_host.ts` - ping against a host that does not exist.
import { createClient } from '@clickhouse/client-web'

const client = createClient({
  // In a browser application, configure the URL/credentials directly here
  // (or build them from a runtime configuration object). The defaults below
  // assume a ClickHouse instance running locally without authentication.
  url: 'http://localhost:8123',
})
const pingResult = await client.ping()
if (pingResult.success) {
  console.log('[ExistingHostPing] Ping to the existing host is successful')
} else {
  console.error(
    '[ExistingHostPing] Ping expected to succeed, but got:',
    pingResult,
  )
}
await client.close()
