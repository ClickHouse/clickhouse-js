import { withCompressionHeaders } from '@clickhouse/client-common'
import Http from 'http'
import type {
  NodeConnectionParams,
  RequestParams,
} from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'

export class NodeCustomAgentConnection extends NodeBaseConnection {
  constructor(params: NodeConnectionParams) {
    if (!params.http_agent) {
      throw new Error(
        'http_agent is required to create NodeCustomAgentConnection',
      )
    }
    super(params, params.http_agent)
  }

  protected createClientRequest(params: RequestParams): Http.ClientRequest {
    const headers = withCompressionHeaders({
      headers: params.headers,
      compress_request: params.compress_request,
      decompress_response: params.decompress_response,
    })
    return Http.request(params.url, {
      method: params.method,
      agent: this.agent,
      timeout: this.params.request_timeout,
      signal: params.abort_signal,
      headers,
    })
  }
}
