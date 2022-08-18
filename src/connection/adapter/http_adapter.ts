import Http from 'http'
import type { Logger } from '../../logger'

import type { Connection, ConnectionParams } from '../connection'
import type { RequestParams } from './base_http_adapter'
import { BaseHttpAdapter } from './base_http_adapter'

export class HttpAdapter extends BaseHttpAdapter implements Connection {
  constructor(config: ConnectionParams, logger: Logger) {
    const agent = new Http.Agent({
      keepAlive: true,
      timeout: config.request_timeout,
    })
    super(config, logger, agent)
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
