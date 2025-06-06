import type {
  BaseClickHouseClientConfigOptions,
  ConnectionParams,
} from '@clickhouse/client-common'
import { DefaultLogger, LogWriter } from '@clickhouse/client-common'
import { createClient } from '../../src'
import type { CreateConnectionParams } from '../../src/connection'
import * as c from '../../src/connection/create_connection'

describe('[Node.js] createClient', () => {
  it('throws on incorrect "url" config value', () => {
    expect(() => createClient({ url: 'foobar' })).toThrow(
      jasmine.objectContaining({
        message: jasmine.stringContaining('ClickHouse URL is malformed.'),
      }),
    )
  })

  it('should not mutate provided configuration', async () => {
    const config: BaseClickHouseClientConfigOptions = {
      url: 'https://localhost:8443',
    }
    createClient(config)
    // initial configuration is not overridden by the defaults we assign
    // when we transform the specified config object to the connection params
    expect(config).toEqual({
      url: 'https://localhost:8443',
    })
  })

  describe('URL parameters parsing', () => {
    const params: ConnectionParams = {
      url: new URL('https://my.host:8443'),
      request_timeout: 42_000,
      max_open_connections: 10,
      compression: {
        compress_request: false,
        decompress_response: false,
      },
      auth: { username: 'bob', password: 'secret', type: 'Credentials' },
      database: 'analytics',
      clickhouse_settings: {},
      log_writer: new LogWriter(new DefaultLogger(), 'Connection'),
      keep_alive: { enabled: true },
      http_headers: {
        'X-ClickHouse-Auth': 'secret_token',
      },
      application_id: 'my_app',
    }

    let createConnectionStub: jasmine.Spy
    beforeEach(() => {
      createConnectionStub = spyOn(c, 'createConnection').and.callThrough()
    })

    it('should parse URL parameters and create a valid connection', async () => {
      createClient({
        url:
          'https://bob:secret@my.host:8443/analytics?' +
          [
            // base config parameters
            'application=my_app',
            'request_timeout=42000',
            'http_header_X-ClickHouse-Auth=secret_token',
            // Node.js specific
            'keep_alive_idle_socket_ttl=1500',
          ].join('&'),
      })
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: params,
        tls: undefined,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 1500,
        },
        set_basic_auth_header: true,
        http_agent: undefined,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
    })

    it('should parse pathname and db from the URL and create a valid connection', async () => {
      createClient({
        url:
          'https://bob:secret@my.host:8443/analytics?' +
          [
            // base config parameters
            'application=my_app',
            'pathname=my_proxy',
            'request_timeout=42000',
            'http_header_X-ClickHouse-Auth=secret_token',
            // Node.js specific
            'keep_alive_idle_socket_ttl=1500',
          ].join('&'),
      })
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: {
          ...params,
          url: new URL('https://my.host:8443/my_proxy'),
        },
        tls: undefined,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 1500,
        },
        set_basic_auth_header: true,
        http_agent: undefined,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
    })

    it('should parse username and password with special characters', async () => {
      const username = '! $'
      const password = '(#%%@) '
      const auth = `${encodeURIComponent(username)}:${encodeURIComponent(password)}`
      createClient({
        url:
          `https://${auth}@my.host:8443/analytics?` +
          [
            // base config parameters
            'application=my_app',
            'pathname=my_proxy',
            'request_timeout=42000',
            'http_header_X-ClickHouse-Auth=secret_token',
            // Node.js specific
            'keep_alive_idle_socket_ttl=1500',
          ].join('&'),
      })
      expect(createConnectionStub).toHaveBeenCalledWith({
        connection_params: {
          ...params,
          url: new URL('https://my.host:8443/my_proxy'),
          auth: { username, password, type: 'Credentials' },
        },
        tls: undefined,
        keep_alive: {
          enabled: true,
          idle_socket_ttl: 1500,
        },
        set_basic_auth_header: true,
        http_agent: undefined,
        capture_enhanced_stack_trace: false,
      } satisfies CreateConnectionParams)
      expect(createConnectionStub).toHaveBeenCalledTimes(1)
    })
  })
})
