/**
 * Maps undici errors to the errors that the client gives with the built-in
 * `node:http` transport. The client errors must not depend on the transport:
 * user code checks them, for example `err.code === 'ECONNRESET'` in retry logic.
 * The original undici error is always in `cause`.
 *
 * Errors without a mapping (for example `ECONNREFUSED` or `ENOTFOUND`, which
 * come from `node:net` and are the same for both transports) do not change.
 */

/** The user aborted the request. Matches both errors of the built-in transport:
 *  `name: "AbortError"` before the request is sent, and the message
 *  "The user aborted a request." after that. */
export const AbortedErrorMessage = "The user aborted a request.";
export const TimeoutErrorMessage = "Timeout error.";

const RequestTimeoutCodes = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** For the built-in transport, every failure while the body streams is
 *  `Error: aborted` with `code: "ECONNRESET"` (from `http.IncomingMessage`). */
const BodyFailureCodes = new Set([
  "UND_ERR_SOCKET", // the server closed the connection
  "ECONNRESET", // the server reset the connection
  "UND_ERR_BODY_TIMEOUT", // request_timeout between two body chunks
  "UND_ERR_ABORTED", // the request was aborted
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH", // the body is shorter than Content-Length
]);

/** Maps an error of `Agent.request()`: the response headers did not arrive. */
export function toRequestError(
  err: unknown,
  signal: AbortSignal | undefined,
): Error {
  // With a custom reason (`controller.abort(reason)`), undici rejects with the
  // reason itself, so the signal state is the check, not the error type.
  if (signal?.aborted) {
    return withCode(
      new Error(AbortedErrorMessage, { cause: err }),
      "ABORT_ERR",
      "AbortError",
    );
  }
  const code = getCode(err);
  if (code !== undefined && RequestTimeoutCodes.has(code)) {
    return new Error(TimeoutErrorMessage, { cause: err });
  }
  if (code === "UND_ERR_SOCKET") {
    return withCode(new Error("socket hang up", { cause: err }), "ECONNRESET");
  }
  if (code === "UND_ERR_HEADERS_OVERFLOW") {
    return withCode(
      new Error("Parse Error: Header overflow", { cause: err }),
      "HPE_HEADER_OVERFLOW",
    );
  }
  if (err instanceof Error && err.name === "HTTPParserError") {
    // undici: "Response does not match the HTTP/1.1 protocol (<reason>)".
    // The built-in transport: "Parse Error: <reason>", with an `HPE_*` code.
    // undici 8 does not set the `HPE_*` code (it reads its llhttp error table
    // by the wrong key), so the code is only copied when undici sets it.
    const reason = /\(([^)]*)\)$/.exec(err.message)?.[1] ?? err.message;
    return withCode(new Error(`Parse Error: ${reason}`, { cause: err }), code);
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Maps an error of the response body stream. A `destroy(err)` call by the
 *  user with an own error does not match any code, so it does not change
 *  (unless the request signal is aborted, see below). */
export function toBodyError(
  err: Error,
  signal: AbortSignal | undefined,
): Error {
  const code = getCode(err);
  if (
    (code !== undefined && BodyFailureCodes.has(code)) ||
    isAbortError(err) ||
    // An abort with a custom reason destroys the body with that reason.
    (signal?.aborted === true && err === signal.reason)
  ) {
    return withCode(new Error("aborted", { cause: err }), "ECONNRESET");
  }
  return err;
}

function isAbortError(err: unknown): boolean {
  return (
    (err as { name?: unknown } | undefined)?.name === "AbortError" ||
    getCode(err) === "UND_ERR_ABORTED"
  );
}

function getCode(err: unknown): string | undefined {
  const code = (err as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? code : undefined;
}

function withCode(err: Error, code: string | undefined, name?: string): Error {
  if (code !== undefined) {
    (err as NodeJS.ErrnoException).code = code;
  }
  if (name !== undefined) {
    err.name = name;
  }
  return err;
}
