import type { ClickHouseClientConfigOptions } from 'client/src'
import { ClickHouseClient } from 'client/src'
import { NodeHttpConnection } from './node_http_connection'
import { NodeHttpsConnection } from './node_https_connection'
import type { Connection, ConnectionParams } from 'client-common/src/connection'

export function createConnection(params: ConnectionParams): Connection {
  // TODO throw ClickHouseClient error
  switch (params.url.protocol) {
    case 'http:':
      return new NodeHttpConnection(params)
    case 'https:':
      return new NodeHttpsConnection(params)
    default:
      throw new Error('Only HTTP(s) adapters are supported')
  }
}

export function createClient(
  config?: Omit<ClickHouseClientConfigOptions, 'connection'>
): ClickHouseClient {
  return new ClickHouseClient({
    connection: (config) => {
      switch (config.url.protocol) {
        case 'http:':
          return new NodeHttpConnection(config)
        case 'https:':
          return new NodeHttpsConnection(config)
        default:
          throw new Error('Only HTTP(s) adapters are supported')
      }
    },
    ...(config || {}),
  })
}
