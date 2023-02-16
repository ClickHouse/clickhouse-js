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
  const ca_cert = fs.readFileSync(`${certsPath}/ca.crt`)
  const cert = fs.readFileSync(`${certsPath}/client.crt`)
  const key = fs.readFileSync(`${certsPath}/client.key`)

  it('should work with basic TLS', async () => {
    client = createClient({
      host: 'https://server.clickhouseconnect.test:8443',
      tls: {
        ca_cert,
      },
    })
    const resultSet = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 3',
      format: 'CSV',
    })
    expect(await resultSet.text()).toEqual('0\n1\n2\n')
  })

  it('should work with mutual TLS', async () => {
    client = createClient({
      host: 'https://server.clickhouseconnect.test:8443',
      username: 'cert_user',
      tls: {
        ca_cert,
        cert,
        key,
      },
    })
    const resultSet = await client.query({
      query: 'SELECT number FROM system.numbers LIMIT 3',
      format: 'CSV',
    })
    expect(await resultSet.text()).toEqual('0\n1\n2\n')
  })

  it('should fail when hostname does not match', async () => {
    client = createClient({
      host: 'https://localhost:8443',
      username: 'cert_user',
      tls: {
        ca_cert,
        cert,
        key,
      },
    })
    await expect(
      client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'CSV',
      })
    ).rejects.toThrowError('Hostname/IP does not match certificate')
  })

  it('should fail with invalid certificates', async () => {
    client = createClient({
      host: 'https://server.clickhouseconnect.test:8443',
      username: 'cert_user',
      tls: {
        ca_cert,
        cert: fs.readFileSync(`${certsPath}/server.crt`),
        key: fs.readFileSync(`${certsPath}/server.key`),
      },
    })
    const errorMessage =
      process.version.startsWith('v18') || process.version.startsWith('v19')
        ? 'unsupported certificate'
        : 'socket hang up'
    await expect(
      client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'CSV',
      })
    ).rejects.toThrowError(errorMessage)
  })
})
