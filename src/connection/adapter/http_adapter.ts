import type { LogWriter } from "../../logger";

import type { Connection, ConnectionParams } from "../connection";
import { BaseHttpAdapter } from "./base_http_adapter";
import Http from "http";

export class HttpAdapter extends BaseHttpAdapter implements Connection {
  constructor(config: ConnectionParams, logger: LogWriter) {
    super(
      config,
      logger,
      new Http.Agent({
        keepAlive: true,
        timeout: config.request_timeout,
        maxSockets: config.max_open_connections,
      })
    )
  }
}
