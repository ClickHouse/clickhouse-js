import { withCompressionHeaders } from '@clickhouse/client-common'
import Http from 'http'
import type {
  NodeConnectionParams,
  RequestParams,
} from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'

export class NodeHttpConnection extends NodeBaseConnection {
  constructor(params: NodeConnectionParams) {
    const agent = new Http.Agent({
      keepAlive: params.keep_alive.enabled,
      maxSockets: params.max_open_connections,
    })
    super(params, agent)
  }

  protected createClientRequest(params: RequestParams): Http.ClientRequest {
    return Http.request(params.url, {
      method: params.method,
      agent: this.agent,
      headers: withCompressionHeaders({
        headers: this.headers,
        compress_request: params.compress_request,
        decompress_response: params.decompress_response,
      }),
      signal: params.abort_signal,
    })
  }
}
