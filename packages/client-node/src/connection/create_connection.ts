import type { ConnectionParams } from '@clickhouse/client-common'
import type {
  NodeBaseConnection,
  NodeConnectionParams,
} from './node_base_connection'
import { NodeHttpConnection } from './node_http_connection'
import { NodeHttpsConnection } from './node_https_connection'

export function createConnection(
  params: ConnectionParams,
  tls: NodeConnectionParams['tls'],
  keep_alive: NodeConnectionParams['keep_alive'],
): NodeBaseConnection {
  switch (params.url.protocol) {
    case 'http:':
      return new NodeHttpConnection({ ...params, keep_alive })
    case 'https:':
      return new NodeHttpsConnection({ ...params, tls, keep_alive })
    default:
      throw new Error('Only HTTP and HTTPS protocols are supported')
  }
}
