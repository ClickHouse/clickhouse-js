import Http from 'http'
import type { RequestParams } from './node_base_connection'
import { NodeBaseConnection } from './node_base_connection'
import type { Connection, ConnectionParams } from 'client-common/src/connection'

export class NodeHttpConnection
  extends NodeBaseConnection
  implements Connection
{
  constructor(config: ConnectionParams) {
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
