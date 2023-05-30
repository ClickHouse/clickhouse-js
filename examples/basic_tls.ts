import { createClient } from '@clickhouse/client'
import fs from 'fs'

void (async () => {
  const client = createClient({
    host: 'https://server.clickhouseconnect.test:8443',
    tls: {
      ca_cert: fs.readFileSync(
        '.docker/clickhouse/single_node_tls/certificates/ca.crt'
      ),
    },
  })
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 2',
    format: 'JSONEachRow',
  })
  console.info(await rows.json())
  await client.close()
})()
