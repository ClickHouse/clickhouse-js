import type { ConnectionParams } from "../common/index";
import type http from "http";
import type https from "node:https";
import type {
  NodeBaseConnection,
  NodeConnectionParams,
} from "./node_base_connection";
import { NodeCustomAgentConnection } from "./node_custom_agent_connection";
import { NodeHttpConnection } from "./node_http_connection";
import { NodeHttpsConnection } from "./node_https_connection";
import { NodeTransportConnection } from "./node_transport_connection";
import type { NodeTransportFactory } from "./transport";

export interface CreateConnectionParams {
  connection_params: ConnectionParams;
  tls: NodeConnectionParams["tls"];
  keep_alive: NodeConnectionParams["keep_alive"];
  http_agent: http.Agent | https.Agent | undefined;
  set_basic_auth_header: boolean;
  capture_enhanced_stack_trace: boolean;
  eagerly_destroy_stale_sockets?: boolean;
  max_response_headers_size?: number;
  transport?: NodeTransportFactory;
}

/** A factory for easier mocking after Node.js 22.18 */
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class NodeConnectionFactory {
  static create({
    connection_params,
    tls,
    keep_alive,
    http_agent,
    set_basic_auth_header,
    capture_enhanced_stack_trace,
    eagerly_destroy_stale_sockets = false,
    max_response_headers_size,
    transport,
  }: CreateConnectionParams): NodeBaseConnection {
    if (transport !== undefined) {
      if (http_agent !== undefined) {
        throw new Error(
          `The http_agent and transport options cannot be used together: ` +
            `the ${transport.name} transport does not use a node:http agent.`,
        );
      }
      const protocol = connection_params.url.protocol;
      if (protocol !== "http:" && protocol !== "https:") {
        throw new Error("Only HTTP and HTTPS protocols are supported");
      }
      return new NodeTransportConnection({
        ...connection_params,
        set_basic_auth_header,
        capture_enhanced_stack_trace,
        keep_alive,
        // Same as the built-in transport: the TLS settings apply to HTTPS only.
        tls: protocol === "https:" ? tls : undefined,
        eagerly_destroy_stale_sockets,
        max_response_headers_size,
        transport,
      });
    }
    if (http_agent !== undefined) {
      return new NodeCustomAgentConnection({
        ...connection_params,
        set_basic_auth_header,
        capture_enhanced_stack_trace,
        keep_alive, // only used to enforce proper KeepAlive headers
        http_agent,
        eagerly_destroy_stale_sockets,
        max_response_headers_size,
      });
    }
    switch (connection_params.url.protocol) {
      case "http:":
        return new NodeHttpConnection({
          ...connection_params,
          set_basic_auth_header,
          capture_enhanced_stack_trace,
          keep_alive,
          eagerly_destroy_stale_sockets,
          max_response_headers_size,
        });
      case "https:":
        return new NodeHttpsConnection({
          ...connection_params,
          set_basic_auth_header,
          capture_enhanced_stack_trace,
          keep_alive,
          tls,
          eagerly_destroy_stale_sockets,
          max_response_headers_size,
        });
      default:
        throw new Error("Only HTTP and HTTPS protocols are supported");
    }
  }
}
