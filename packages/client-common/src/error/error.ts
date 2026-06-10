const codeRe = /(?:Code|Error): (?<code>\d+)/;
// The exception marker that separates the preamble from the message.
const exceptionMarker = "Exception: ";
// Matches the human-readable message followed by the `(TYPE)` marker at the
// start of an exception body. Anchored at `^` and using a lazy message so the
// match runs in linear time. The type lookahead requires at least three
// consecutive uppercase letters so that parenthesised groups such as `(2)` or
// `(official build)` are not mistaken for the error type.
const messageAndTypeRe =
  /^(?<message>[\s\S]*?)\((?<type>(?=[A-Z0-9_]*[A-Z]{3})[A-Z0-9_]+)\)/;

interface ParsedClickHouseError {
  message: string;
  code: string;
  type?: string;
}

/** An error that is thrown by the ClickHouse server. */
export class ClickHouseError extends Error {
  readonly code: string;
  readonly type: string | undefined;
  constructor({ message, code, type }: ParsedClickHouseError) {
    super(message);
    this.code = code;
    this.type = type;

    // Set the prototype explicitly, see:
    // https://github.com/Microsoft/TypeScript/wiki/Breaking-Changes#extending-built-ins-like-error-array-and-map-may-no-longer-work
    Object.setPrototypeOf(this, ClickHouseError.prototype);
  }
}

export function parseError(input: string | Error): ClickHouseError | Error {
  const inputIsError = input instanceof Error;
  const message = inputIsError ? input.message : input;
  const codeMatch = message.match(codeRe);
  // In cluster mode, the server wraps the original exception, repeating the
  // `Code`/`Exception`/`(TYPE)` markers, e.g.:
  //   Code: 57. DB::Exception: There was an error on [host:9000]: Code: 57. DB::Exception: <message>. (TABLE_ALREADY_EXISTS) (version ...). (TABLE_ALREADY_EXISTS) (version ...)
  // Anchor on the innermost (last) exception so the original message and type
  // are extracted instead of the outer wrapper. Using `lastIndexOf` keeps the
  // parsing linear and avoids the backtracking of a single greedy regex.
  const lastExceptionIndex = message.lastIndexOf(exceptionMarker);
  if (codeMatch?.groups && lastExceptionIndex !== -1) {
    const body = message.slice(lastExceptionIndex + exceptionMarker.length);
    const bodyMatch = body.match(messageAndTypeRe);
    if (bodyMatch?.groups) {
      const { code } = codeMatch.groups as { code: string };
      const { message: errorMessage, type } = bodyMatch.groups as {
        message: string;
        type: string;
      };
      return new ClickHouseError({ code, message: errorMessage, type });
    }
  }
  return inputIsError ? input : new Error(input);
}

/** Captures the current stack trace from the sync context before going async.
 *  It is necessary since the majority of the stack trace is lost when an async callback is called. */
export function getCurrentStackTrace(): string {
  const stack = new Error().stack;
  if (!stack) return "";

  // Skip the first three lines of the stack trace, containing useless information
  // - Text `Error`
  // - Info about this function call
  // - Info about the originator of this function call, e.g., `request`
  // Additionally, the original stack trace is, in fact, reversed.
  return stack.split("\n").slice(3).reverse().join("\n");
}

/** Having the stack trace produced by the {@link getCurrentStackTrace} function,
 *  add it to an arbitrary error stack trace. No-op if there is no additional stack trace to add.
 *  It could happen if this feature was disabled due to its performance overhead. */
export function enhanceStackTrace<E extends Error>(
  err: E,
  stackTrace: string | undefined,
): E {
  if (err.stack && stackTrace) {
    const firstNewlineIndex = err.stack.indexOf("\n");
    const firstLine = err.stack.substring(0, firstNewlineIndex);
    const errStack = err.stack.substring(firstNewlineIndex + 1);
    err.stack = `${firstLine}\n${stackTrace}\n${errStack}`;
  }
  return err;
}
