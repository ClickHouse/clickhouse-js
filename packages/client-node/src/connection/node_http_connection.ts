import { withCompressionHeaders } from "@clickhouse/client-common";
import Http from "http";
import type { NodeConnectionParams } from "./node_base_connection";
import type { RequestParams } from "./socket_pool";
import { NodeBaseConnection } from "./node_base_connection";

export class NodeHttpConnection extends NodeBaseConnection {
  constructor(params: NodeConnectionParams) {
    const agent = new Http.Agent({
      keepAlive: params.keep_alive.enabled,
      maxSockets: params.max_open_connections,
    });
    super(params, agent);
  }

  protected createClientRequest(params: RequestParams): Http.ClientRequest {
    const headers = withCompressionHeaders({
      headers: params.headers,
      request_compression_codec: params.request_compression_codec,
      response_compression_codec: params.response_compression_codec,
    });
    return Http.request(params.url, {
      method: params.method,
      agent: this.agent,
      timeout: this.params.request_timeout,
      signal: params.abort_signal,
      headers,
      ...(this.params.max_response_headers_size !== undefined && {
        maxHeaderSize: this.params.max_response_headers_size,
      }),
    });
  }
}
