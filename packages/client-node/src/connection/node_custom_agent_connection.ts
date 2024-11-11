import Http from 'http'
import Https from 'https'
import type {
  NodeConnectionParams,
  RequestParams,
} from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'
import { withCompressionHeaders } from '@clickhouse/client-common'

export class NodeCustomAgentConnection extends NodeBaseConnection {
  private readonly httpRequestFn: typeof Http.request | typeof Https.request
  constructor(params: NodeConnectionParams) {
    if (!params.http_agent) {
      throw new Error(
        'http_agent is required to create NodeCustomAgentConnection',
      )
    }
    super(params, params.http_agent)

    // See https://github.com/ClickHouse/clickhouse-js/issues/352
    if (params.http_agent instanceof Https.Agent) {
      this.httpRequestFn = Https.request
    } else {
      this.httpRequestFn = Http.request
    }
  }

  protected createClientRequest(params: RequestParams): Http.ClientRequest {
    const headers = withCompressionHeaders({
      headers: params.headers,
      enable_request_compression: params.enable_request_compression,
      enable_response_compression: params.enable_response_compression,
    })
    return this.httpRequestFn(params.url, {
      method: params.method,
      agent: this.agent,
      timeout: this.params.request_timeout,
      signal: params.abort_signal,
      headers,
    })
  }
}
