import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'

void (async () => {
  const client = createClient({
    url: getFromEnv('CLICKHOUSE_URL'),
    password: getFromEnv('CLICKHOUSE_PASSWORD'),
  })
  console.info(await client.ping())
})()

function getFromEnv(key: string) {
  if (process.env[key]) {
    return process.env[key]
  }
  console.error(`${key} environment variable should be set`)
  process.exit(1)
}
