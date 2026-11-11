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
import { toBodyError, toRequestError } from "./errors";
import { checkUndiciVersion, getInstalledUndiciVersion } from "./version";
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
 *  `undici` is not a dependency of this package: install it yourself
 *  (`npm install undici@^8.12.3`). The supported versions are 8.12.3 and later
 *  8.x versions; `undiciTransport()` throws an error for other versions.
 *
 *  ```ts
 *  import { createClient } from '@clickhouse/client'
 *  import { undiciTransport } from '@clickhouse/client/undici'
 *
 *  const client = createClient({ transport: undiciTransport() })
 *  ```
 *
 *  In native ESM, import `@clickhouse/client/undici/index.js`: the package has
 *  no `exports` field, so native ESM does not resolve the shorter path.
 *  @experimental - unstable API; it might be a subject to change in the future;
 *                  please provide your feedback in the repository. */
export function undiciTransport(
  options: UndiciTransportOptions = {},
): NodeTransportFactory {
  checkUndiciVersion(getInstalledUndiciVersion());
  return {
    name: "undici",
    create: (params) => new UndiciTransport(params, options),
  };
}

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
    // Bun replaces the `undici` module with its own partial implementation,
    // which does not have `Agent.request()`.
    if (typeof this.agent.request !== "function") {
      throw new Error(
        "The undici transport needs the undici package (npm install undici), " +
          "but this runtime replaces the undici module with an implementation " +
          "that does not have Agent.request(). This happens on Bun. " +
          "Use the default transport on this runtime.",
      );
    }
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
      const request = this.agent.request({
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
        // The user's signal (see `passThroughRequestAbort()`): undici handles
        // it natively (an already aborted signal, an abort before or while the
        // request is sent, and an abort while the response body streams), and
        // it removes its listener when the request ends.
        signal: params.abort_signal,
      });
      response = await rejectOnAbort(request, params.abort_signal);
    } catch (err) {
      throw enhanceStackTrace(
        toRequestError(err, params.abort_signal),
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
      body: withIdleTimeout(
        withNodeHttpErrors(response.body, params.abort_signal),
        this.params.request_timeout,
      ),
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

type UndiciResponse = Awaited<ReturnType<Agent["request"]>>;

/** undici issue: an abort of a request that waits in the queue for a
 *  connection (all `max_open_connections` are in use) only stores the abort
 *  reason. The request rejects when it gets a connection, which can be never.
 *  The `node:http` transport rejects at once, so reject here at once too.
 *  undici then does not send the request when it gets a connection. */
function rejectOnAbort(
  request: Promise<UndiciResponse>,
  signal: AbortSignal | undefined,
): Promise<UndiciResponse> {
  if (signal === undefined || signal.aborted) {
    // undici rejects an already aborted signal itself.
    return request;
  }
  return new Promise<UndiciResponse>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      settled = true;
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    request.then(
      (response) => {
        signal.removeEventListener("abort", onAbort);
        if (settled) {
          // The abort came first: nobody reads this body.
          response.body.destroy();
        } else {
          resolve(response);
        }
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        if (!settled) {
          reject(err);
        }
      },
    );
  });
}

/** undici issue: undici does not run `bodyTimeout` while the body stream is
 *  paused (for example, when the application does not read a result). The
 *  connection then stays in use forever, and with `max_open_connections`
 *  in use, the client hangs. The `node:http` transport destroys the response
 *  when no data arrives for `request_timeout` (an idle socket), so do the same:
 *  each chunk that undici pushes into the body restarts the timer. */
function withIdleTimeout<T extends Stream.Readable>(
  body: T,
  timeout_ms: number,
): T {
  if (!(timeout_ms > 0) || !Number.isFinite(timeout_ms)) {
    return body;
  }
  const timer = setTimeout(() => {
    body.destroy(
      Object.assign(new Error("Body Timeout Error"), {
        code: "UND_ERR_BODY_TIMEOUT",
      }),
    );
  }, timeout_ms);
  // Do not keep the process alive for this timer only.
  timer.unref();
  const push = body.push.bind(body);
  body.push = (chunk: unknown, encoding?: BufferEncoding) => {
    timer.refresh();
    return push(chunk, encoding);
  };
  body.once("close", () => clearTimeout(timer));
  return body;
}

/** Maps the client configuration to the undici `Agent` options.
 *  @internal exported for the tests only. */
export function getAgentOptions(params: NodeTransportParams): Agent.Options {
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
    // The built-in transport sets the socket timeout before the socket
    // connects, so `request_timeout` covers the connect too. Without this,
    // undici uses its own default (10 s).
    connectTimeout: params.request_timeout,
    // undici 8 negotiates HTTP/2 (ALPN) by default. Behind an HTTP/2 proxy,
    // `connections` then no longer limits the parallel requests (they share
    // one HTTP/2 connection), and a response that is cut off can look like a
    // complete one. ClickHouse uses HTTP/1.1; the built-in transport too.
    allowH2: false,
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

/** Gives the body stream the same errors as `http.IncomingMessage`.
 *
 *  1. undici destroys the body with its own errors (a closed socket, a body
 *     timeout, an abort); these are mapped with {@link toBodyError}.
 *  2. undici emits an `error` event (`RequestAbortedError`, `UND_ERR_ABORTED`)
 *     when the body is destroyed without an error before it ends. Node.js
 *     `http.IncomingMessage` does not. Without an `error` listener, that event
 *     is an uncaught exception, so a user who calls `stream.destroy()` to stop
 *     reading a response would crash the process. Keep the `node:http`
 *     behavior: the request is still aborted and the connection is released,
 *     but this one error is not emitted.
 *
 *  Both go through `destroy()`: undici destroys the body with `destroy(err)`. */
function withNodeHttpErrors<T extends Stream.Readable>(
  body: T,
  signal: AbortSignal | undefined,
): T {
  const destroy = body.destroy.bind(body);
  body.destroy = (err?: Error) => {
    if (err !== undefined && err !== null) {
      return destroy(toBodyError(err, signal));
    }
    // A second call does nothing (the stream is already destroyed), so it must
    // not add a listener: an error of an earlier `destroy(err)` call can still
    // be scheduled, and the user can already handle it.
    if (!body.destroyed) {
      // Prepend, so that this listener runs first, and the listener count
      // includes the user's listeners: Node.js removes a `once` listener
      // before it runs, so a count taken after it would be 0.
      body.prependOnceListener("error", (e: unknown) => {
        const isAbortedError =
          (e as { code?: unknown } | undefined)?.code === "UND_ERR_ABORTED";
        // Do not hide other errors when nobody else listens for them.
        if (!isAbortedError && body.listenerCount("error") === 0) {
          throw e;
        }
      });
    }
    return destroy(err);
  };
  return body;
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
