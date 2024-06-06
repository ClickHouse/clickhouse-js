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
    if (this.params.tls !== undefined) {
      const headers: Http.OutgoingHttpHeaders = {
        ...this.defaultHeaders,
        'X-ClickHouse-User': params?.auth?.username ?? this.params.username,
        'X-ClickHouse-Key': params?.auth?.password ?? this.params.password,
      }
      const tlsType = this.params.tls.type
      switch (tlsType) {
        case 'Basic':
          return headers
        case 'Mutual':
          return {
            ...headers,
            'X-ClickHouse-SSL-Certificate-Auth': 'on',
          }
        default:
          throw new Error(`Unknown TLS type: ${tlsType}`)
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
