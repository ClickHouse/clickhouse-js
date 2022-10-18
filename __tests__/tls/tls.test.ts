import type { ClickHouseClient } from '../../src'
import { createClient } from '../../src'
import { createTestClient } from '../utils'
import * as fs from 'fs'

describe('TLS connection', () => {
  let client: ClickHouseClient
  beforeEach(() => {
    client = createTestClient()
  })
  afterEach(async () => {
    await client.close()
  })

  const certsPath = '.docker/clickhouse/single_node_tls/certificates'

  it('should work with mutual TLS', async () => {
    client = createClient({
      host: 'https://server.clickhouseconnect.test:8443',
      username: 'cert_user',
      tls: {
        enable: true,
        ca_cert: fs.readFileSync(`${certsPath}/ca.crt`),
        cert: fs.readFileSync(`${certsPath}/client.crt`),
        key: fs.readFileSync(`${certsPath}/client.key`),
      },
    })
    const resultSet = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 3',
      format: 'CSV',
    })
    expect(await resultSet.text()).toEqual('0\n1\n2\n')
  })
})
