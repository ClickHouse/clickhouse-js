import { createClient } from '@clickhouse/client'
import fs from 'fs'

void (async () => {
  const certsPath = '.docker/clickhouse/single_node_tls/certificates'
  const client = createClient({
    host: 'https://server.clickhouseconnect.test:8443',
    username: 'cert_user',
    tls: {
      ca_cert: fs.readFileSync(`${certsPath}/ca.crt`),
      cert: fs.readFileSync(`${certsPath}/client.crt`),
      key: fs.readFileSync(`${certsPath}/client.key`),
    },
  })
  const rows = await client.query({
    query: 'SELECT number FROM system.numbers LIMIT 2',
    format: 'JSONEachRow',
  })
  console.info(await rows.json())
  await client.close()
})()
