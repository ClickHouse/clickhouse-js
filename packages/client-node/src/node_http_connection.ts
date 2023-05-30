import Http from 'http'
import type {
  NodeConnectionParams,
  RequestParams,
} from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'
import type { Connection } from '@clickhouse/client-common/connection'
import type Stream from 'stream'

export class NodeHttpConnection
  extends NodeBaseConnection
  implements Connection<Stream.Readable>
{
  constructor(config: NodeConnectionParams) {
    const agent = new Http.Agent({
      keepAlive: true,
      timeout: config.request_timeout,
      maxSockets: config.max_open_connections,
    })
    super(config, agent)
  }

  protected createClientRequest(
    url: URL,
    params: RequestParams
  ): Http.ClientRequest {
    return Http.request(params.url, {
      method: params.method,
      agent: this.agent,
      headers: this.getHeaders(params),
    })
  }
}
