import type { BaseQueryParams } from '@clickhouse/client-common'
import { withCompressionHeaders } from '@clickhouse/client-common'
import type Http from 'http'
import Https from 'https'
import type {
  NodeConnectionParams,
  RequestParams,
} from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'

export class NodeHttpsConnection extends NodeBaseConnection {
  constructor(params: NodeConnectionParams) {
    const agent = new Https.Agent({
      keepAlive: params.keep_alive.enabled,
      maxSockets: params.max_open_connections,
      ca: params.tls?.ca_cert,
      key: params.tls?.type === 'Mutual' ? params.tls.key : undefined,
      cert: params.tls?.type === 'Mutual' ? params.tls.cert : undefined,
    })
    super(params, agent)
  }

  protected override buildRequestHeaders(
    params?: BaseQueryParams,
  ): Http.OutgoingHttpHeaders {
    // ping does not require authentication; the other methods do.
    if (params !== undefined) {
      if (this.params.tls?.type === 'Mutual') {
        return {
          'X-ClickHouse-User': params.username,
          'X-ClickHouse-Key': params.password,
          'X-ClickHouse-SSL-Certificate-Auth': 'on',
          ...this.defaultHeaders,
        }
      }
      if (this.params.tls?.type === 'Basic') {
        return {
          'X-ClickHouse-User': params.username,
          'X-ClickHouse-Key': params.password,
          ...this.defaultHeaders,
        }
      }
    }
    return super.buildRequestHeaders(params)
  }

  protected createClientRequest(params: RequestParams): Http.ClientRequest {
    const headers = withCompressionHeaders({
      headers: params.headers,
      compress_request: params.compress_request,
      decompress_response: params.decompress_response,
    })
    return Https.request(params.url, {
      method: params.method,
      agent: this.agent,
      timeout: this.params.request_timeout,
      signal: params.abort_signal,
      headers,
    })
  }
}
