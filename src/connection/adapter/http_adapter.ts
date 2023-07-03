import Http from 'http'
import type { LogWriter } from '../../logger'

import type { Connection, ConnectionParams } from '../connection'
import type { RequestParams } from './base_http_adapter'
import { BaseHttpAdapter } from './base_http_adapter'

export class HttpAdapter extends BaseHttpAdapter implements Connection {
  constructor(config: ConnectionParams, logger: LogWriter) {
    const agent = new Http.Agent({
      keepAlive: config.keep_alive.enabled,
      maxSockets: config.max_open_connections,
    })
    super(config, logger, agent)
  }

  protected createClientRequest(
    params: RequestParams,
    abort_signal?: AbortSignal
  ): Http.ClientRequest {
    return Http.request(params.url, {
      method: params.method,
      agent: this.agent,
      headers: this.getHeaders(params),
      signal: abort_signal,
    })
  }
}
