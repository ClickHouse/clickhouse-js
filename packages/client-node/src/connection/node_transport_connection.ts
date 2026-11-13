import type Http from "http";
import type { NodeConnectionParams } from "./node_base_connection";
import { NodeBaseConnection } from "./node_base_connection";

/** A connection that sends its requests through
 *  {@link NodeConnectionParams.transport} instead of `node:http` / `node:https`. */
export class NodeTransportConnection extends NodeBaseConnection {
  constructor(params: NodeConnectionParams) {
    if (params.transport === undefined) {
      throw new Error(
        "transport is required to create NodeTransportConnection",
      );
    }
    super(params, undefined);
  }

  protected createClientRequest(): Http.ClientRequest {
    // Not called: the transport sends the requests.
    throw new Error(
      "NodeTransportConnection does not create node:http requests",
    );
  }
}
