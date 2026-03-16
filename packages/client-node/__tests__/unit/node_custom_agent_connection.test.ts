import { describe, it, expect, vi } from 'vitest'
import Http from 'http'
import Https from 'https'
import { ClickHouseLogLevel, LogWriter } from '@clickhouse/client-common'
import { TestLogger } from '../../../client-common/__tests__/utils/test_logger'
import type { NodeConnectionParams } from '../../src/connection'
import { NodeCustomAgentConnection } from '../../src/connection/node_custom_agent_connection'

/** Extends NodeCustomAgentConnection to expose protected methods for testing. */
class TestableCustomAgentConnection extends NodeCustomAgentConnection {
  public testCreateClientRequest(
    ...args: Parameters<NodeCustomAgentConnection['createClientRequest']>
  ): Http.ClientRequest {
    return this.createClientRequest(...args)
  }
}

function buildCustomAgentConnectionParams(
  overrides?: Partial<NodeConnectionParams>,
): NodeConnectionParams {
  return {
    url: new URL('http://localhost:8123'),
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
      'CustomAgentConnectionTest',
      ClickHouseLogLevel.OFF,
    ),
    log_level: ClickHouseLogLevel.OFF,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 2500,
    },
    set_basic_auth_header: true,
    capture_enhanced_stack_trace: false,
    http_agent: new Http.Agent(),
    ...overrides,
  }
}

describe('[Node.js] NodeCustomAgentConnection', () => {
  describe('constructor', () => {
    it('should throw when http_agent is not provided', () => {
      expect(
        () =>
          new TestableCustomAgentConnection(
            buildCustomAgentConnectionParams({
              http_agent: undefined,
            }),
          ),
      ).toThrow('http_agent is required to create NodeCustomAgentConnection')
    })

    it('should use Https.request for https URLs', () => {
      const httpsAgent = new Https.Agent()
      const mockRequest = {} as Http.ClientRequest
      const httpsRequestSpy = vi
        .spyOn(Https, 'request')
        .mockReturnValue(mockRequest)
      const httpRequestSpy = vi.spyOn(Http, 'request')

      const connection = new TestableCustomAgentConnection(
        buildCustomAgentConnectionParams({
          url: new URL('https://localhost:8443'),
          http_agent: httpsAgent,
        }),
      )
      expect(connection).toBeInstanceOf(NodeCustomAgentConnection)

      const abortController = new AbortController()
      connection.testCreateClientRequest({
        method: 'GET',
        url: new URL('https://localhost:8443'),
        headers: {},
        abort_signal: abortController.signal,
        query: 'SELECT 1',
        query_id: 'test',
        log_writer: buildCustomAgentConnectionParams().log_writer,
        log_level: ClickHouseLogLevel.OFF,
      })

      expect(httpsRequestSpy).toHaveBeenCalledTimes(1)
      expect(httpRequestSpy).not.toHaveBeenCalled()

      httpsRequestSpy.mockRestore()
      httpRequestSpy.mockRestore()
    })

    it('should use Http.request for http URLs', () => {
      const httpAgent = new Http.Agent()
      const mockRequest = {} as Http.ClientRequest
      const httpRequestSpy = vi
        .spyOn(Http, 'request')
        .mockReturnValue(mockRequest)
      const httpsRequestSpy = vi.spyOn(Https, 'request')
      const connection = new TestableCustomAgentConnection(
        buildCustomAgentConnectionParams({
          url: new URL('http://localhost:8123'),
          http_agent: httpAgent,
        }),
      )
      expect(connection).toBeInstanceOf(NodeCustomAgentConnection)

      const abortController = new AbortController()
      connection.testCreateClientRequest({
        method: 'GET',
        url: new URL('http://localhost:8123'),
        headers: {},
        abort_signal: abortController.signal,
        query: 'SELECT 1',
        query_id: 'test',
        log_writer: buildCustomAgentConnectionParams().log_writer,
        log_level: ClickHouseLogLevel.OFF,
      })

      expect(httpRequestSpy).toHaveBeenCalledTimes(1)
      expect(httpsRequestSpy).not.toHaveBeenCalled()

      httpRequestSpy.mockRestore()
      httpsRequestSpy.mockRestore()
    })
  })

  describe('createClientRequest', () => {
    it('should call Http.request for http URLs', () => {
      const httpAgent = new Http.Agent()

      const mockRequest = {} as Http.ClientRequest
      const httpRequestSpy = vi
        .spyOn(Http, 'request')
        .mockReturnValue(mockRequest)

      const connection = new TestableCustomAgentConnection(
        buildCustomAgentConnectionParams({
          url: new URL('http://localhost:8123'),
          http_agent: httpAgent,
        }),
      )

      const url = new URL('http://localhost:8123/?query_id=test')
      const abortController = new AbortController()
      const result = connection.testCreateClientRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'text/plain' },
        abort_signal: abortController.signal,
        query: 'SELECT 1',
        query_id: 'test-query-id',
        log_writer: new LogWriter(
          new TestLogger(),
          'CustomAgentConnectionTest',
          ClickHouseLogLevel.OFF,
        ),
        log_level: ClickHouseLogLevel.OFF,
      })

      expect(result).toBe(mockRequest)
      expect(httpRequestSpy).toHaveBeenCalledTimes(1)
      expect(httpRequestSpy).toHaveBeenCalledWith(url, {
        method: 'POST',
        agent: httpAgent,
        timeout: 30_000,
        signal: abortController.signal,
        headers: { 'Content-Type': 'text/plain' },
      })

      httpRequestSpy.mockRestore()
    })

    it('should call Https.request for https URLs', () => {
      const httpsAgent = new Https.Agent()

      const mockRequest = {} as Http.ClientRequest
      const httpsRequestSpy = vi
        .spyOn(Https, 'request')
        .mockReturnValue(mockRequest)

      const connection = new TestableCustomAgentConnection(
        buildCustomAgentConnectionParams({
          url: new URL('https://localhost:8443'),
          http_agent: httpsAgent,
        }),
      )

      const url = new URL('https://localhost:8443/?query_id=test')
      const abortController = new AbortController()
      const result = connection.testCreateClientRequest({
        method: 'GET',
        url,
        headers: {},
        abort_signal: abortController.signal,
        query: 'SELECT 1',
        query_id: 'test-query-id',
        log_writer: new LogWriter(
          new TestLogger(),
          'CustomAgentConnectionTest',
          ClickHouseLogLevel.OFF,
        ),
        log_level: ClickHouseLogLevel.OFF,
      })

      expect(result).toBe(mockRequest)
      expect(httpsRequestSpy).toHaveBeenCalledTimes(1)
      expect(httpsRequestSpy).toHaveBeenCalledWith(url, {
        method: 'GET',
        agent: httpsAgent,
        timeout: 30_000,
        signal: abortController.signal,
        headers: {},
      })

      httpsRequestSpy.mockRestore()
    })

    it('should add compression headers when compression is enabled', () => {
      const httpAgent = new Http.Agent()

      const mockRequest = {} as Http.ClientRequest
      const httpRequestSpy = vi
        .spyOn(Http, 'request')
        .mockReturnValue(mockRequest)

      const connection = new TestableCustomAgentConnection(
        buildCustomAgentConnectionParams({
          url: new URL('http://localhost:8123'),
          http_agent: httpAgent,
        }),
      )

      const url = new URL('http://localhost:8123/?query_id=test')
      const abortController = new AbortController()
      connection.testCreateClientRequest({
        method: 'POST',
        url,
        headers: { 'Content-Type': 'text/plain' },
        abort_signal: abortController.signal,
        enable_request_compression: true,
        enable_response_compression: true,
        query: 'SELECT 1',
        query_id: 'test-query-id',
        log_writer: new LogWriter(
          new TestLogger(),
          'CustomAgentConnectionTest',
          ClickHouseLogLevel.OFF,
        ),
        log_level: ClickHouseLogLevel.OFF,
      })

      expect(httpRequestSpy).toHaveBeenCalledTimes(1)
      const calledHeaders = httpRequestSpy.mock.calls[0][1]?.headers as Record<
        string,
        string
      >
      expect(calledHeaders['Content-Encoding']).toBe('gzip')
      expect(calledHeaders['Accept-Encoding']).toBe('gzip')

      httpRequestSpy.mockRestore()
    })
  })
})
