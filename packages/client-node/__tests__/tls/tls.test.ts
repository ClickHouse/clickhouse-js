import { it, expect, describe, beforeEach, afterEach } from 'vitest'
import type { ClickHouseClient } from '@clickhouse/client-common'
import { createTestClient } from '../utils/client.node'
import * as fs from 'fs'
import Http from 'http'
import https from 'node:https'
import type Stream from 'stream'
import { createClient } from '../../src'
import Https from 'https'
import http from 'http'
import { vi } from 'vitest'

describe('[Node.js] TLS connection', () => {
  let client: ClickHouseClient<Stream.Readable>
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
      url: 'https://server.clickhouseconnect.test:8443',
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
      url: 'https://server.clickhouseconnect.test:8443',
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
      url: 'https://localhost:8443',
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
      }),
    ).rejects.toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          'Hostname/IP does not match certificate',
        ),
      }),
    )
  })

  it('should fail with invalid certificates', async () => {
    client = createClient({
      url: 'https://server.clickhouseconnect.test:8443',
      username: 'cert_user',
      tls: {
        ca_cert,
        cert: fs.readFileSync(`${certsPath}/server.crt`),
        key: fs.readFileSync(`${certsPath}/server.key`),
      },
    })
    // FIXME: add proper error message matching (does not work on Node.js 18/20)
    await expect(
      client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'CSV',
      }),
    ).rejects.toThrow()
  })

  // query only; the rest of the methods are tested in the auth.test.ts in the common package
  describe('request auth override', () => {
    it('should override the credentials with basic TLS', async () => {
      client = createClient({
        url: 'https://server.clickhouseconnect.test:8443',
        username: 'gibberish',
        password: 'gibberish',
        tls: {
          ca_cert,
        },
      })
      const resultSet = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'CSV',
        auth: {
          username: 'default',
          password: '',
        },
      })
      expect(await resultSet.text()).toEqual('0\n1\n2\n')
    })

    it('should override the credentials with mutual TLS', async () => {
      client = createClient({
        url: 'https://server.clickhouseconnect.test:8443',
        username: 'gibberish',
        password: 'gibberish',
        tls: {
          ca_cert,
          cert,
          key,
        },
      })
      const resultSet = await client.query({
        query: 'SELECT number FROM system.numbers LIMIT 3',
        format: 'CSV',
        auth: {
          username: 'cert_user',
          password: '',
        },
      })
      expect(await resultSet.text()).toEqual('0\n1\n2\n')
    })

    describe('Custom HTTPS agent', () => {
      it('should work with a custom HTTPS agent', async () => {
        const httpsRequestStub = vi.spyOn(Https, 'request')
        const agent = new https.Agent({
          maxFreeSockets: 5,
          ca: ca_cert,
        })
        const client = createClient({
          url: 'https://server.clickhouseconnect.test:8443',
          http_agent: agent,
          http_headers: {
            'X-ClickHouse-User': 'default',
            'X-ClickHouse-Key': '',
          },
          set_basic_auth_header: false,
        })
        const rs = await client.query({
          query: 'SELECT 144 AS result',
          format: 'JSONEachRow',
        })
        expect(await rs.json()).toEqual([{ result: 144 }])
        expect(httpsRequestStub).toHaveBeenCalledTimes(1)
        const callArgs = httpsRequestStub.mock.calls[0]
        expect(callArgs[1].agent).toBe(agent)
      })

      // does not really belong to the TLS test; keep it here for consistency
      it('should work with a custom HTTP agent', async () => {
        const httpRequestStub = vi.spyOn(Http, 'request')
        const agent = new http.Agent({
          maxFreeSockets: 5,
        })
        const client = createClient({
          url: 'http://localhost:8123',
          http_agent: agent,
        })
        const rs = await client.query({
          query: 'SELECT 144 AS result',
          format: 'JSONEachRow',
        })
        expect(await rs.json()).toEqual([{ result: 144 }])
        expect(httpRequestStub).toHaveBeenCalledTimes(1)
        const callArgs = httpRequestStub.mock.calls[0]
        expect(callArgs[1].agent).toBe(agent)
      })
    })
  })
})
