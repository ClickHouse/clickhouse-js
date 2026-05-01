import { createClient } from '@clickhouse/client'
import fs from 'fs'

const client = createClient({
  url:
    process.env['CLICKHOUSE_TLS_URL'] ??
    'https://server.clickhouseconnect.test:8443',
  tls: {
    ca_cert: fs.readFileSync(
      '../.docker/clickhouse/single_node_tls/certificates/ca.crt',
    ),
  },
})
const rows = await client.query({
  query: 'SELECT number FROM system.numbers LIMIT 2',
  format: 'JSONEachRow',
})
console.info(await rows.json())
await client.close()
