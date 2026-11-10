import type Http from "http";
import Stream from "stream";
import { Agent } from "undici";
import {
  enhanceStackTrace,
  getCurrentStackTrace,
  withCompressionHeaders,
  ClickHouseLogLevel,
  type ConnOperation,
} from "../common/index";
import { isStream } from "../utils";
import { createRequestCompressor } from "../connection/compression";
import {
  getRequestResult,
  getResponseStream,
  type ResponseContext,
  type TransportResponse,
} from "../connection/response";
import type { RequestParams, RequestResult } from "../connection/socket_pool";
import type {
  NodeTransport,
  NodeTransportFactory,
  NodeTransportParams,
} from "../connection/transport";

export interface UndiciTransportOptions {
  /** Options for the undici `Agent`. They override the values that the
   *  transport takes from the client configuration
   *  (`max_open_connections`, `keep_alive`, `request_timeout`, `tls`,
   *  `max_response_headers_size`).
   *  @default undefined */
  agent_options?: Agent.Options;
}

/** Sends the client requests with [undici](https://undici.nodejs.org)
 *  instead of the built-in `node:http` / `node:https` modules.
 *
 *  `undici` is an optional peer dependency: install it with `npm install undici`.
 *
 *  ```ts
 *  import { createClient } from '@clickhouse/client'
 *  import { undiciTransport } from '@clickhouse/client/undici'
 *
 *  const client = createClient({ transport: undiciTransport() })
 *  ```
 *  @experimental - unstable API; it might be a subject to change in the future;
 *                  please provide your feedback in the repository. */
export function undiciTransport(
  options: UndiciTransportOptions = {},
): NodeTransportFactory {
  return {
    name: "undici",
    create: (params) => new UndiciTransport(params, options),
  };
}

/** The error messages are the same as the messages of the built-in transport,
 *  so that error handling in user code works with both transports. */
const AbortedErrorMessage = "The user aborted a request.";
const TimeoutErrorMessage = "Timeout error.";
const TimeoutErrorCodes = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

class UndiciTransport implements NodeTransport {
  private readonly params: NodeTransportParams;
  private readonly agent: Agent;
  private requestCounter = 0;

  constructor(params: NodeTransportParams, options: UndiciTransportOptions) {
    this.params = params;
    this.agent = new Agent({
      ...getAgentOptions(params),
      ...options.agent_options,
    });
  }

  async request(
    params: RequestParams,
    op: ConnOperation,
  ): Promise<RequestResult> {
    const { log_writer, log_level, query_id } = params;
    const currentStackTrace = this.params.capture_enhanced_stack_trace
      ? getCurrentStackTrace()
      : undefined;
    this.requestCounter += 1;
    const request_id = `${this.params.connection_id}:${this.requestCounter}`;
    const start = Date.now();

    let response: Awaited<ReturnType<Agent["request"]>>;
    try {
      response = await this.agent.request({
        origin: params.url.origin,
        path: params.url.pathname + params.url.search,
        method: params.method,
        headers: toUndiciHeaders(
          withCompressionHeaders({
            headers: params.headers,
            request_compression_codec: params.request_compression?.codec,
            response_compression_codec: params.response_compression_codec,
          }),
        ),
        body: getRequestBody(params),
        signal: params.abort_signal,
      });
    } catch (err) {
      throw enhanceStackTrace(
        toClientError(err, params.abort_signal),
        currentStackTrace,
      );
    }

    if (log_level <= ClickHouseLogLevel.DEBUG) {
      log_writer.debug({
        module: "Undici Transport",
        message: `${op}: got a response from ClickHouse`,
        args: {
          operation: op,
          connection_id: this.params.connection_id,
          query_id,
          request_id,
          request_method: params.method,
          request_path: params.url.pathname,
          response_status: response.statusCode,
          response_time_ms: Date.now() - start,
        },
      });
    }

    const transportResponse: TransportResponse = {
      status_code: response.statusCode,
      headers: response.headers as Http.IncomingHttpHeaders,
      body: response.body,
    };
    const ctx: ResponseContext = {
      op,
      params,
      connection_id: this.params.connection_id,
      request_id,
      current_stack_trace: currentStackTrace,
      json_handling: this.params.json ?? {
        parse: JSON.parse,
        stringify: JSON.stringify,
      },
      log_writer,
      log_level,
    };
    let stream: Stream.Readable;
    try {
      stream = getResponseStream(ctx, transportResponse);
    } catch (err) {
      // Release the connection: nobody reads this body.
      response.body.destroy();
      throw err;
    }
    return getRequestResult(ctx, transportResponse, stream);
  }

  async close(): Promise<void> {
    await this.agent.destroy();
  }
}

function getAgentOptions(params: NodeTransportParams): Agent.Options {
  const { keep_alive, tls } = params;
  const agentOptions: Agent.Options = {
    // `null` is "no limit" for undici; the client accepts `Infinity` for that.
    connections: Number.isFinite(params.max_open_connections)
      ? params.max_open_connections
      : null,
    // Same as `socket.setTimeout(request_timeout)` in the built-in transport:
    // the time to wait for the response headers,
    // and then the maximum idle time between two body chunks.
    headersTimeout: params.request_timeout,
    bodyTimeout: params.request_timeout,
  };
  if (!keep_alive.enabled) {
    // A pipelining value of 0 disables keep-alive in undici.
    agentOptions.pipelining = 0;
  } else if (keep_alive.idle_socket_ttl > 0) {
    // undici uses the server `Keep-Alive: timeout=N` hint (minus a safety
    // threshold) when it is available; `keepAliveMaxTimeout` makes sure
    // that an idle socket is never kept for longer than `idle_socket_ttl`.
    agentOptions.keepAliveTimeout = keep_alive.idle_socket_ttl;
    agentOptions.keepAliveMaxTimeout = keep_alive.idle_socket_ttl;
  }
  if (params.max_response_headers_size !== undefined) {
    agentOptions.maxHeaderSize = params.max_response_headers_size;
  }
  if (tls !== undefined) {
    agentOptions.connect =
      tls.type === "Mutual"
        ? { ca: tls.ca_cert, cert: tls.cert, key: tls.key }
        : { ca: tls.ca_cert };
  }
  return agentOptions;
}

function getRequestBody(
  params: RequestParams,
): string | Stream.Readable | undefined {
  const { body, request_compression } = params;
  if (body === undefined || request_compression === undefined) {
    return body;
  }
  const source = isStream(body) ? body : Stream.Readable.from([body]);
  // An error in the source or in the compressor destroys the returned stream,
  // and undici then rejects the request with that error.
  return Stream.pipeline(
    source,
    createRequestCompressor(request_compression),
    () => {
      // The error is handled by undici, see above.
    },
  );
}

function toUndiciHeaders(
  headers: Http.OutgoingHttpHeaders,
): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    result[key] = typeof value === "number" ? String(value) : value;
  }
  return result;
}

function toClientError(err: unknown, signal: AbortSignal): Error {
  if (signal.aborted) {
    return new Error(AbortedErrorMessage, { cause: err });
  }
  const code = (err as { code?: unknown } | undefined)?.code;
  if (typeof code === "string" && TimeoutErrorCodes.has(code)) {
    return new Error(TimeoutErrorMessage, { cause: err });
  }
  return err instanceof Error ? err : new Error(String(err));
}
