import { BaseHttpAdapter } from "./base_http_adapter";
import type { Connection, ConnectionParams } from "../connection";
import type { LogWriter } from "../../logger";
import Https from "https";

export class HttpsAdapter extends BaseHttpAdapter implements Connection {
  constructor(config: ConnectionParams, logger: LogWriter) {
    super(
      config,
      logger,
      new Https.Agent({
        keepAlive: true,
        timeout: config.request_timeout,
        maxSockets: config.max_open_connections,
        ca: config.tls?.ca_cert,
        key: config.tls?.type === 'Mutual' ? config.tls.key : undefined,
        cert: config.tls?.type === 'Mutual' ? config.tls.cert : undefined,
      })
    )
  }

  protected override buildDefaultHeaders(
    username: string,
    password: string
  ): Record<string, string> {
    if (this.config.tls?.type === 'Mutual') {
      return {
        'X-ClickHouse-User': username,
        'X-ClickHouse-Key': password,
        'X-ClickHouse-SSL-Certificate-Auth': 'on',
      }
    }
    if (this.config.tls?.type === 'Basic') {
      return {
        'X-ClickHouse-User': username,
        'X-ClickHouse-Key': password,
      }
    }
    return super.buildDefaultHeaders(username, password)
  }
}
