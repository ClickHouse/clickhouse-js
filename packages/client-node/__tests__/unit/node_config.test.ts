import { describe, it, expect, beforeEach, vi } from 'vitest'

import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
} from '@clickhouse/client-common'
import { ClickHouseLogLevel, LogWriter } from '@clickhouse/client-common'
import { TestLogger } from '../../../client-common/__tests__/utils/test_logger'
import { Buffer } from 'buffer'
import http from 'http'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { NodeConfigImpl } from '../../src/config'
import {
  type CreateConnectionParams,
  type NodeBaseConnection,
  NodeConnectionFactory,
} from '../../src/connection'

describe('[Node.js] Config implementation details', () => {
  describe('HandleImplSpecificURLParams', () => {
    it('should handle known URL params', async () => {
      const url = new URL(
        'http://localhost:8123/?' +
          ['keep_alive_idle_socket_ttl=2500'].join('&'),
      )
      const config: BaseClickHouseClientConfigOptions = {
        keep_alive: {
          enabled: false,
        },
      }
      const res = NodeConfigImpl.handle_specific_url_params(config, url)
      expect(res.config).toEqual({
        keep_alive: {
          enabled: false, // kept the value from the initial config
          idle_socket_ttl: 2500,
        },
      } as unknown as BaseClickHouseClientConfigOptions)
      expect([...res.unknown_params]).toEqual([])
      expect([...res.handled_params]).toEqual(['keep_alive_idle_socket_ttl'])
    })

    it('should indicate that one of the URL parameters is unknown without throwing an error', async () => {
      const url = new URL('http://localhost:8123?unknown_param=true')
      const config: BaseClickHouseClientConfigOptions = {
        username: 'alice',
      }
      const res = NodeConfigImpl.handle_specific_url_params(config, url)
      expect(res.config).toEqual({ username: 'alice' })
      expect([...res.unknown_params]).toEqual(['unknown_param'])
      expect([...res.handled_params]).toEqual([])
    })

    it('should do nothing if there are no parameters to parse', async () => {
      const url = new URL('http://localhost:8123')
      const config: BaseClickHouseClientConfigOptions = {
        application: 'my_app',
      }
      const res = NodeConfigImpl.handle_specific_url_params(config, url)
      expect(res.config).toEqual({
        application: 'my_app',
      } as unknown as BaseClickHouseClientConfigOptions)
      expect([...res.unknown_params]).toEqual([])
      expect([...res.handled_params]).toEqual([])
    })
  })

  describe('MakeConnection', () => {
    const params: ConnectionParams = {
      url: new URL('http://localhost:8123'),
      request_timeout: 1000,
      max_open_connections: 10,
      compression: {
        compress_request: true,
        decompress_response: true,
      },
      auth: {
        username: 'alice',
        password: 'qwerty',
        type: 'Credentials',
      },
      database: 'default',
      clickhouse_settings: {},
      log_writer: new LogWriter(new TestLogger(), 'MakeConnectionTest'),
      log_level: ClickHouseLogLevel.OFF,
      keep_alive: { enabled: false },
    }

    const fakeConnection = { test: true } as unknown as NodeBaseConnection
    const createConnectionStub = vi
      .spyOn(NodeConnectionFactory, 'create')
      .mockReturnValue(fakeConnection)
    beforeEach(() => {
      vi.clearAllMocks()
    })

    it('should create a connection with default KeepAlive settings', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('http://localhost:8123'),
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: undefined,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 2500,
        },
        http_agent: undefined,
        set_basic_auth_header: true,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })

    it('should create a connection with basic TLS', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('https://localhost:8123'),
        tls: {
          ca_cert: Buffer.from('my_ca_cert'),
        },
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: {
          type: 'Basic',
          ca_cert: Buffer.from('my_ca_cert'),
        },
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 2500,
        },
        http_agent: undefined,
        set_basic_auth_header: true,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })

    it('should create a connection with mutual TLS', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('https://localhost:8123'),
        tls: {
          ca_cert: Buffer.from('my_ca_cert'),
          cert: Buffer.from('my_cert'),
          key: Buffer.from('my_key'),
        },
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: {
          type: 'Mutual',
          ca_cert: Buffer.from('my_ca_cert'),
          cert: Buffer.from('my_cert'),
          key: Buffer.from('my_key'),
        },
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 2500,
        },
        http_agent: undefined,
        set_basic_auth_header: true,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })

    it('should create a connection with custom KeepAlive and TLS', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('https://localhost:8123'),
        keep_alive: {
          enabled: false,
          idle_socket_ttl: 42_000,
        },
        tls: {
          ca_cert: Buffer.from('my_ca_cert'),
        },
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: {
          type: 'Basic',
          ca_cert: Buffer.from('my_ca_cert'),
        },
        keep_alive: {
          enabled: false,
          idle_socket_ttl: 42_000,
        },
        http_agent: undefined,
        set_basic_auth_header: true,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })

    it('should create a connection with a custom agent and disabled auth header', async () => {
      const agent = new http.Agent({
        keepAlive: true,
        maxSockets: 2,
      })
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('https://localhost:8123'),
        keep_alive: {
          enabled: true,
        },
        set_basic_auth_header: false,
        http_agent: agent,
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: undefined,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 2500,
        },
        http_agent: agent,
        set_basic_auth_header: false,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })

    it('should create a connection with enhanced stack traces option', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('https://localhost:8123'),
        capture_enhanced_stack_trace: true,
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: undefined,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 2500,
        },
        http_agent: undefined,
        set_basic_auth_header: true,
        capture_enhanced_stack_trace: true,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })
  })
})
