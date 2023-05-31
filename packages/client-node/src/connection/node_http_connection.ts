import Http from 'http'
import type {
  NodeConnectionParams,
  RequestParams,
} from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'
import type { Connection } from '@clickhouse/client-common/connection'
import type Stream from 'stream'
import { withCompressionHeaders } from '@clickhouse/client-common/utils'

export class NodeHttpConnection
  extends NodeBaseConnection
  implements Connection<Stream.Readable>
{
  constructor(params: NodeConnectionParams) {
    const agent = new Http.Agent({
      keepAlive: true,
      timeout: params.request_timeout,
      maxSockets: params.max_open_connections,
    })
    super(params, agent)
  }

  protected createClientRequest(
    url: URL,
    params: RequestParams
  ): Http.ClientRequest {
    return Http.request(params.url, {
      method: params.method,
      agent: this.agent,
      headers: withCompressionHeaders({
        headers: this.headers,
        compress_request: params.compress_request,
        decompress_response: params.decompress_response,
      }),
    })
  }
}
