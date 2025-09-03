import type { ConnectionParams } from '@clickhouse/client-common'
import type http from 'http'
import type https from 'node:https'
import type {
  NodeBaseConnection,
  NodeConnectionParams,
} from './node_base_connection'
import { NodeCustomAgentConnection } from './node_custom_agent_connection'
import { NodeHttpConnection } from './node_http_connection'
import { NodeHttpsConnection } from './node_https_connection'

export interface CreateConnectionParams {
  connection_params: ConnectionParams
  tls: NodeConnectionParams['tls']
  keep_alive: NodeConnectionParams['keep_alive']
  http_agent: http.Agent | https.Agent | undefined
  set_basic_auth_header: boolean
  capture_enhanced_stack_trace: boolean
}

/** A factory for easier mocking after Node.js 22.18 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class NodeConnectionFactory {
  static create({
    connection_params,
    tls,
    keep_alive,
    http_agent,
    set_basic_auth_header,
    capture_enhanced_stack_trace,
  }: CreateConnectionParams): NodeBaseConnection {
    if (http_agent !== undefined) {
      return new NodeCustomAgentConnection({
        ...connection_params,
        set_basic_auth_header,
        capture_enhanced_stack_trace,
        keep_alive, // only used to enforce proper KeepAlive headers
        http_agent,
      })
    }
    switch (connection_params.url.protocol) {
      case 'http:':
        return new NodeHttpConnection({
          ...connection_params,
          set_basic_auth_header,
          capture_enhanced_stack_trace,
          keep_alive,
        })
      case 'https:':
        return new NodeHttpsConnection({
          ...connection_params,
          set_basic_auth_header,
          capture_enhanced_stack_trace,
          keep_alive,
          tls,
        })
      default:
        throw new Error('Only HTTP and HTTPS protocols are supported')
    }
  }
}
