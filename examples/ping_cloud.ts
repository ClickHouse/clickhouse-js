import { createClient } from '@clickhouse/client'
void (async () => {
  const client = createClient({
    host: getFromEnv('CLICKHOUSE_HOST'),
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
