/** How a connection gives the user's `abort_signal` to its transport. */
export interface RequestAbort {
  /** The signal for the transport (`RequestParams.abort_signal`). */
  signal: AbortSignal | undefined;
  /** Called when the client method fails, to make sure that the outgoing
   *  request is terminated. */
  abort(reason: string): void;
  /** Called when the client method ends (after the response stream is drained,
   *  if the method drains it). */
  cleanup(): void;
}

/** Passes the user's signal to the transport unchanged. For transports with
 *  native `AbortSignal` support (undici), which handle every case themselves:
 *  an already aborted signal, an abort while the request is sent, and an
 *  abort while the response body streams. */
export function passThroughRequestAbort(params: {
  abort_signal?: AbortSignal;
}): RequestAbort {
  return {
    signal: params.abort_signal,
    abort: () => {
      // The transport ends a failed request itself.
    },
    cleanup: () => {
      // The transport removes its own listener.
    },
  };
}

/** The built-in `node:http` / `node:https` transport: a wrapper over the user's
 *  signal to terminate the failed requests. Moved here without changes from
 *  `NodeBaseConnection`, so that the behavior of that transport does not change. */
export function wrappedRequestAbort(params: {
  abort_signal?: AbortSignal;
}): RequestAbort {
  const controller = new AbortController();
  function onAbort() {
    controller.abort();
  }
  params.abort_signal?.addEventListener("abort", onAbort);
  return {
    signal: controller.signal,
    abort: (reason) => controller.abort(reason),
    cleanup: () => {
      params.abort_signal?.removeEventListener("abort", onAbort);
    },
  };
}
