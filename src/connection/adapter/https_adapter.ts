import type { RequestParams } from './base_http_adapter'
import { BaseHttpAdapter } from './base_http_adapter'
import type { Connection, ConnectionParams } from '../connection'
import type { Logger } from '../../logger'
import Https from 'https'
import type Http from 'http'

export class HttpsAdapter extends BaseHttpAdapter implements Connection {
  constructor(config: ConnectionParams, logger: Logger) {
    const agent = new Https.Agent({
      keepAlive: true,
      timeout: config.request_timeout,
      maxSockets: config.max_open_connections,
      ca: config.tls?.ca_cert,
      key: config.tls?.key,
      cert: config.tls?.cert,
    })
    super(config, logger, agent)
  }

  protected override buildDefaultHeaders(
    username: string,
    password: string
  ): Http.OutgoingHttpHeaders {
    return {
      'X-ClickHouse-User': username,
      'X-ClickHouse-SSL-Certificate-Auth': 'on',
    }
  }

  protected createClientRequest(
    url: URL,
    params: RequestParams
  ): Http.ClientRequest {
    return Https.request(params.url, {
      method: params.method,
      agent: this.agent,
      headers: this.getHeaders(params),
    })
  }
}
