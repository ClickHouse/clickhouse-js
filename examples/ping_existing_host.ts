import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

/**
 * This example assumes that you have a ClickHouse server running locally
 * (for example, from our root docker-compose.yml file).
 *
 * Illustrates a successful ping against an existing host and how it might be handled on the application side.
 * Ping might be a useful tool to check if the server is available when the application starts,
 * especially with ClickHouse Cloud, where an instance might be idling and will wake up after a ping.
 *
 * See also:
 *  - `ping_non_existing_host.ts` - ping against a host that does not exist.
 *  - `ping_timeout.ts`           - ping that times out.
 */
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
