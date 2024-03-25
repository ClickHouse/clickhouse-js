import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
} from '@clickhouse/client-common'
import { LogWriter } from '@clickhouse/client-common'
import { TestLogger } from '@test/utils'
import { Buffer } from 'buffer'
import type { NodeClickHouseClientConfigOptions } from '../../src/config'
import { NodeConfigImpl } from '../../src/config'
import type { NodeBaseConnection } from '../../src/connection'
import * as c from '../../src/connection/create_connection'

describe('[Node.js] Config implementation details', () => {
  describe('HandleImplSpecificURLParams', () => {
    it('should handle known URL params', async () => {
      const url = new URL(
        'http://localhost:8123/?' +
          [
            'keep_alive_retry_on_expired_socket=true',
            'keep_alive_socket_ttl=1000',
          ].join('&'),
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
          retry_on_expired_socket: true,
          socket_ttl: 1000,
        },
      } as unknown as BaseClickHouseClientConfigOptions)
      expect([...res.unknown_params]).toEqual([])
      expect([...res.handled_params]).toEqual([
        'keep_alive_retry_on_expired_socket',
        'keep_alive_socket_ttl',
      ])
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
      username: 'alice',
      password: 'qwerty',
      database: 'default',
      clickhouse_settings: {},
      log_writer: new LogWriter(new TestLogger()),
      keep_alive: { enabled: false },
    }

    let createConnectionStub: jasmine.Spy
    const fakeConnection = { test: true } as unknown as NodeBaseConnection
    beforeEach(() => {
      createConnectionStub = spyOn(c, 'createConnection').and.returnValue(
        fakeConnection,
      )
    })

    it('should create a connection with default KeepAlive settings', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('http://localhost:8123'),
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith(
        params,
        undefined, // TLS
        {
          enabled: true,
          socket_ttl: 2500,
          retry_on_expired_socket: false,
        },
      )
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
      expect(createConnectionStub).toHaveBeenCalledWith(
        params,
        {
          type: 'Basic',
          ca_cert: Buffer.from('my_ca_cert'),
        },
        {
          enabled: true,
          socket_ttl: 2500,
          retry_on_expired_socket: false,
        },
      )
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
      expect(createConnectionStub).toHaveBeenCalledWith(
        params,
        {
          type: 'Mutual',
          ca_cert: Buffer.from('my_ca_cert'),
          cert: Buffer.from('my_cert'),
          key: Buffer.from('my_key'),
        },
        {
          enabled: true,
          socket_ttl: 2500,
          retry_on_expired_socket: false,
        },
      )
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })

    it('should create a connection with custom KeepAlive and TLS', async () => {
      const nodeConfig: NodeClickHouseClientConfigOptions = {
        url: new URL('https://localhost:8123'),
        keep_alive: {
          enabled: false,
          socket_ttl: 42_000,
          retry_on_expired_socket: true,
        },
        tls: {
          ca_cert: Buffer.from('my_ca_cert'),
        },
      }
      const res = NodeConfigImpl.make_connection(nodeConfig as any, params)
      expect(createConnectionStub).toHaveBeenCalledWith(
        params,
        {
          type: 'Basic',
          ca_cert: Buffer.from('my_ca_cert'),
        },
        {
          enabled: false,
          socket_ttl: 42_000,
          retry_on_expired_socket: true,
        },
      )
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
      expect(res).toEqual(fakeConnection)
    })
  })
})
