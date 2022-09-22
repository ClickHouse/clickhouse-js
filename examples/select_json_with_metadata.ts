import type { ResponseJSON } from '@clickhouse/client'
import { createClient } from '@clickhouse/client'
void (async () => {
  const client = createClient()
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 2',
    format: 'JSON',
  })
  const result = await rows.json<ResponseJSON<{ number: string }>>()
  console.info(result)
  await client.close()
})()
