// In cluster mode, the server wraps the original exception, repeating the
// `Code`/`Exception`/`(TYPE)` markers, e.g.:
//   Code: 57. DB::Exception: There was an error on [host:9000]: Code: 57. DB::Exception: <message>. (TABLE_ALREADY_EXISTS) (version ...). (TABLE_ALREADY_EXISTS) (version ...)
// The leading `.*Exception: ` is greedy so we anchor on the innermost (last)
// exception, while `(?<message>.+?)` is lazy so the message stops at the first
// `(TYPE)` marker rather than swallowing the repeated suffixes. The type
// lookahead requires at least three consecutive uppercase letters so that
// parenthesised groups like `(2)` or `(official build)` are not mistaken for it.
//
// NOTE: In normal usage, the string fed to `parseError` comes from ClickHouse,
// but it may still include user-controlled fragments (e.g. parts of a query) or
// even non-ClickHouse payloads (proxy/HTML errors) when parsing failed requests.
// Keep this regex simple to avoid excessive backtracking on large/unexpected input.
// (If this ever becomes a concern, consider a non-regex parser or input length limits.)
const errorRe =
  /(Code|Error): (?<code>\d+).*Exception: (?<message>.+?)\((?<type>(?=[A-Z0-9_]*[A-Z]{3})[A-Z0-9_]+)\)/s;

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

/** With an output format of the JSON family, the server can report an error in that format
 *  instead of as plain text. Version 24.8 does this for every error. Later versions do this for an
 *  error that occurs while the server writes the result (`http_write_exception_in_output_format`,
 *  enabled by default). The exception is then one JSON value in the body. Other rows (column names,
 *  types, data) can come before it. These are the known shapes:
 *  - `{"exception": "<text>"}` for JSONEachRow and the other object-per-row formats;
 *  - a document with a top-level `exception` key for JSON, JSONCompact, JSONObjectEachRow, ...;
 *  - `["<text>"]` for JSONCompactEachRow and its `...WithNames[AndTypes]` variants, after the header rows;
 *  - `{"row":{"exception": "<text>"}}` for JSONEachRowWithProgress on 24.8 (later versions write
 *    `{"exception": "<text>"}` at the top level, like the other formats).
 *  This function returns each string in the body that has one of these shapes. The caller keeps the
 *  first string that it can parse as a ClickHouse error. In this way, the message does not keep the
 *  JSON escaping (for example, `\\"` instead of `"`). The caller also skips a column name and a data
 *  value in a column named `exception`. */
function jsonExceptionCandidates(text: string): string[] {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) {
    return [];
  }
  const candidates: string[] = [];
  // The whole body is one JSON document, or one JSON value per line.
  for (const candidate of [trimmed, ...trimmed.split("\n")]) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue; // not a JSON document: try the next candidate
    }
    const exception = getException(value);
    if (exception !== undefined) {
      candidates.push(exception);
    }
  }
  return candidates;
}

/** Returns the `exception` string of a parsed JSON value. The value must have one of the shapes listed above. */
function getException(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    // `["<text>"]`: a compact format writes the exception as a one-element row
    return value.length === 1 && typeof value[0] === "string"
      ? value[0]
      : undefined;
  }
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const { exception, row } = value as { exception?: unknown; row?: unknown };
  if (typeof exception === "string") {
    return exception;
  }
  // `{"row":{"exception": "<text>"}}` (JSONEachRowWithProgress on 24.8)
  if (row !== null && typeof row === "object" && !Array.isArray(row)) {
    const nested = (row as { exception?: unknown }).exception;
    return typeof nested === "string" ? nested : undefined;
  }
  return undefined;
}

export function parseError(input: string | Error): ClickHouseError | Error {
  const inputIsError = input instanceof Error;
  const text = inputIsError ? input.message : input;
  // Try the JSON candidates first. The raw text of a JSON-wrapped error also
  // matches, but then the message keeps the JSON escaping.
  for (const candidate of [...jsonExceptionCandidates(text), text]) {
    const groups = candidate.match(errorRe)?.groups as
      ParsedClickHouseError | undefined;
    if (groups) {
      return new ClickHouseError(groups);
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
