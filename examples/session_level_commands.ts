import { createClient } from '@clickhouse/client' // or '@clickhouse/client-web'
import * as crypto from 'crypto' // required for Node.js only

void (async () => {
  const client = createClient({
    // with session_id defined, SET and other session commands
    // will affect all the consecutive queries
    session_id: crypto.randomUUID(),
  })

  await client.command({
    query: `SET output_format_json_quote_64bit_integers = 0`,
    clickhouse_settings: { wait_end_of_query: 1 },
  })

  // this query uses output_format_json_quote_64bit_integers = 0
  const rows1 = await client.query({
    query: `SELECT toInt64(42)`,
    format: 'JSONEachRow',
  })
  console.log(await rows1.json())

  await client.command({
    query: `SET output_format_json_quote_64bit_integers = 1`,
    clickhouse_settings: { wait_end_of_query: 1 },
  })

  // this query uses output_format_json_quote_64bit_integers = 1
  const rows2 = await client.query({
    query: `SELECT toInt64(144)`,
    format: 'JSONEachRow',
  })
  console.log(await rows2.json())

  await client.close()
})()
