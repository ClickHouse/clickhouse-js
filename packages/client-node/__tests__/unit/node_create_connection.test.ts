import type { ConnectionParams } from '@clickhouse/client-common'
import http from 'http'
import https from 'node:https'
import {
  createConnection,
  type NodeConnectionParams,
  NodeHttpConnection,
  NodeHttpsConnection,
} from '../../src/connection'
import { NodeCustomAgentConnection } from '../../src/connection/node_custom_agent_connection'

describe('[Node.js] createConnection', () => {
  const keepAliveParams: NodeConnectionParams['keep_alive'] = {
    enabled: true,
    idle_socket_ttl: 2500,
  }
  const tlsParams: NodeConnectionParams['tls'] = undefined

  it('should create an instance of HTTP adapter', async () => {
    expect(adapter).toBeInstanceOf(NodeHttpConnection)
  })
  const adapter = createConnection({
    connection_params: {
      url: new URL('http://localhost'),
    } as ConnectionParams,
    tls: tlsParams,
    keep_alive: keepAliveParams,
    http_agent: undefined,
    set_basic_auth_header: true,
  })

  it('should create an instance of HTTPS adapter', async () => {
    const adapter = createConnection({
      connection_params: {
        url: new URL('https://localhost'),
      } as ConnectionParams,
      tls: tlsParams,
      keep_alive: keepAliveParams,
      http_agent: undefined,
      set_basic_auth_header: true,
    })
    expect(adapter).toBeInstanceOf(NodeHttpsConnection)
  })

  it('should throw if the supplied protocol is unknown', async () => {
    expect(() =>
      createConnection({
        connection_params: {
          url: new URL('tcp://localhost'),
        } as ConnectionParams,
        tls: tlsParams,
        keep_alive: keepAliveParams,
        http_agent: undefined,
        set_basic_auth_header: true,
      }),
    ).toThrowError('Only HTTP and HTTPS protocols are supported')
  })

  describe('Custom HTTP agent', () => {
    it('should create an instance with a custom HTTP agent', async () => {
      const adapter = createConnection({
        connection_params: {
          url: new URL('https://localhost'),
        } as ConnectionParams,
        tls: tlsParams,
        keep_alive: keepAliveParams,
        http_agent: new http.Agent({
          keepAlive: true,
          maxSockets: 2,
        }),
        set_basic_auth_header: false,
      })
      expect(adapter).toBeInstanceOf(NodeCustomAgentConnection)
    })

    it('should create an instance with a custom HTTPS agent', async () => {
      const adapter = createConnection({
        connection_params: {
          url: new URL('https://localhost'),
        } as ConnectionParams,
        tls: tlsParams,
        keep_alive: keepAliveParams,
        http_agent: new https.Agent({
          keepAlive: true,
          maxSockets: 2,
        }),
        set_basic_auth_header: true,
      })
      expect(adapter).toBeInstanceOf(NodeCustomAgentConnection)
    })
  })
})
