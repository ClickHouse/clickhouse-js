import type { ConnOperation } from "../common/index";
import type { NodeConnectionParams } from "./node_base_connection";
import type { RequestParams, RequestResult } from "./socket_pool";

/** Sends one HTTP request to ClickHouse and returns the response.
 *  The connection builds the URL, the headers and the body; the transport only
 *  sends them, and gives back the (decompressed) response stream.
 *  @internal */
export interface NodeTransport {
  request(params: RequestParams, op: ConnOperation): Promise<RequestResult>;
  /** Closes all the sockets that the transport owns. */
  close(): Promise<void>;
}

/** The parameters that a {@link NodeTransportFactory} receives
 *  when the client creates its connection.
 *  @internal */
export type NodeTransportParams = NodeConnectionParams & {
  connection_id: string;
};

/** Creates the HTTP transport for a client. Do not implement it yourself;
 *  use a factory from the package, for example `undiciTransport()` from
 *  `@clickhouse/client/undici`.
 *  @experimental - unstable API; it might be a subject to change in the future. */
export interface NodeTransportFactory {
  /** A short name for the transport, for example `undici`. Used in log messages. */
  readonly name: string;
  /** @internal */
  create(params: NodeTransportParams): NodeTransport;
}
