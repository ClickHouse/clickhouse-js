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

  protected override buildDefaultHeaders(
    username: string,
    password: string,
    additional_headers?: Record<string, string>
  ): Http.OutgoingHttpHeaders {
    if (this.params.tls?.type === 'Mutual') {
      return {
        'X-ClickHouse-User': username,
        'X-ClickHouse-Key': password,
        'X-ClickHouse-SSL-Certificate-Auth': 'on',
      }
    }
    if (this.params.tls?.type === 'Basic') {
      return {
        'X-ClickHouse-User': username,
        'X-ClickHouse-Key': password,
      }
    }
    return super.buildDefaultHeaders(username, password, additional_headers)
  }

  protected createClientRequest(params: RequestParams): Http.ClientRequest {
    return Https.request(params.url, {
      method: params.method,
      agent: this.agent,
      timeout: this.params.request_timeout,
      headers: withCompressionHeaders({
        headers: this.headers,
        compress_request: params.compress_request,
        decompress_response: params.decompress_response,
      }),
      signal: params.abort_signal,
    })
  }
}
