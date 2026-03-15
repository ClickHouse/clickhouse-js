import { describe, it, expect, vi } from 'vitest'
import type Http from 'http'
import Https from 'https'
import { ClickHouseLogLevel, LogWriter } from '@clickhouse/client-common'
import { TestLogger } from '../../../client-common/__tests__/utils/test_logger'
import type { NodeConnectionParams } from '../../src/connection'
import { NodeHttpsConnection } from '../../src/connection'

/** Extends NodeHttpsConnection to expose protected methods for testing. */
class TestableHttpsConnection extends NodeHttpsConnection {
  public getHeaders(
    params?: Parameters<NodeHttpsConnection['buildRequestHeaders']>[0],
  ): Http.OutgoingHttpHeaders {
    return this.buildRequestHeaders(params)
  }
}

function buildHttpsConnectionParams(
  overrides?: Partial<NodeConnectionParams>,
): NodeConnectionParams {
  return {
    url: new URL('https://localhost:8443'),
    request_timeout: 30_000,
    compression: {
      decompress_response: false,
      compress_request: false,
    },
    max_open_connections: 10,
    auth: { username: 'default', password: '', type: 'Credentials' },
    database: 'default',
    clickhouse_settings: {},
    log_writer: new LogWriter(
      new TestLogger(),
      'HttpsConnectionTest',
      ClickHouseLogLevel.OFF,
    ),
    log_level: ClickHouseLogLevel.OFF,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 2500,
    },
    set_basic_auth_header: true,
    capture_enhanced_stack_trace: false,
    ...overrides,
  }
}

describe('[Node.js] NodeHttpsConnection', () => {
  describe('buildRequestHeaders', () => {
    it('should use X-ClickHouse-User/Key headers with Basic TLS', () => {
      const connection = new TestableHttpsConnection(
        buildHttpsConnectionParams({
          tls: {
            type: 'Basic',
            ca_cert: Buffer.from('ca_cert'),
          },
        }),
      )
      const headers = connection.getHeaders()
      expect(headers['X-ClickHouse-User']).toBe('default')
      expect(headers['X-ClickHouse-Key']).toBe('')
      expect(headers).not.toHaveProperty('Authorization')
      expect(headers).not.toHaveProperty('X-ClickHouse-SSL-Certificate-Auth')
    })

    it('should add SSL-Certificate-Auth header with Mutual TLS', () => {
      const connection = new TestableHttpsConnection(
        buildHttpsConnectionParams({
          tls: {
            type: 'Mutual',
            ca_cert: Buffer.from('ca_cert'),
            cert: Buffer.from('cert'),
            key: Buffer.from('key'),
          },
        }),
      )
      const headers = connection.getHeaders()
      expect(headers['X-ClickHouse-User']).toBe('default')
      expect(headers['X-ClickHouse-Key']).toBe('')
      expect(headers['X-ClickHouse-SSL-Certificate-Auth']).toBe('on')
    })

    it('should use per-request credentials when provided with TLS', () => {
      const connection = new TestableHttpsConnection(
        buildHttpsConnectionParams({
          tls: {
            type: 'Basic',
            ca_cert: Buffer.from('ca_cert'),
          },
        }),
      )
      const headers = connection.getHeaders({
        auth: { username: 'alice', password: 's3cret' },
      })
      expect(headers['X-ClickHouse-User']).toBe('alice')
      expect(headers['X-ClickHouse-Key']).toBe('s3cret')
    })

    it('should throw when JWT auth is used with TLS certificates', () => {
      const connection = new TestableHttpsConnection(
        buildHttpsConnectionParams({
          auth: { type: 'JWT', access_token: 'token' } as any,
          tls: {
            type: 'Basic',
            ca_cert: Buffer.from('ca_cert'),
          },
        }),
      )
      expect(() => connection.getHeaders()).toThrow(
        'JWT auth is not supported with HTTPS connection using custom certificates',
      )
    })

    it('should delegate to super when TLS is undefined', () => {
      const connection = new TestableHttpsConnection(
        buildHttpsConnectionParams({ tls: undefined }),
      )
      const headers = connection.getHeaders()
      // Without TLS, it falls through to the base class which uses Authorization header
      expect(headers).toHaveProperty('Authorization')
      expect(headers).not.toHaveProperty('X-ClickHouse-User')
      expect(headers).not.toHaveProperty('X-ClickHouse-Key')
    })
  })

  describe('constructor', () => {
    it('should create an Https.Agent with keep-alive and TLS params', () => {
      const agentSpy = vi.spyOn(Https, 'Agent')
      const caCert = Buffer.from('ca_cert')
      new TestableHttpsConnection(
        buildHttpsConnectionParams({
          keep_alive: { enabled: true, idle_socket_ttl: 5000 },
          max_open_connections: 5,
          tls: {
            type: 'Basic',
            ca_cert: caCert,
          },
        }),
      )
      expect(agentSpy).toHaveBeenCalledWith({
        keepAlive: true,
        maxSockets: 5,
        ca: caCert,
        key: undefined,
        cert: undefined,
      })
      agentSpy.mockRestore()
    })

    it('should pass key and cert for Mutual TLS', () => {
      const agentSpy = vi.spyOn(Https, 'Agent')
      const caCert = Buffer.from('ca_cert')
      const cert = Buffer.from('cert')
      const key = Buffer.from('key')
      new TestableHttpsConnection(
        buildHttpsConnectionParams({
          tls: { type: 'Mutual', ca_cert: caCert, cert, key },
        }),
      )
      expect(agentSpy).toHaveBeenCalledWith({
        keepAlive: true,
        maxSockets: 10,
        ca: caCert,
        key,
        cert,
      })
      agentSpy.mockRestore()
    })
  })
})
