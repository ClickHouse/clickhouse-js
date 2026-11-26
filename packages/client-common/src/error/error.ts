// A server error has the form
//   Code: <code>. DB::Exception: <message> (<TYPE>) (version <version>)
// The server leaves out ` (version ...)` for a request with a `session_id`, and
// adds `, Stack trace (...)` and the stack after the type with the setting
// `stacktrace`. The message itself can have `(UPPERCASE)` groups, for example a
// type name (`Nullable(JSON)`), a token of a syntax error (`(TABLE)`) or
// `(NULL)`, so the type is the group at the end of an exception: before
// ` (version ` or at the end of the text.
//
// The message can also have user text (for example from `throwIf`) that looks
// like these markers: `(FOO) (version 1)` or `(FOO), Stack trace (`. So the
// parser takes only text in the format of the server markers: ` (version `
// with a version of four numbers (`26.11.1.312`), and the full stack trace
// sentence with no end of an exception after it. User text in exactly this
// format, such as `(FOO) (version 26.11.1.312)`, can still change the result.
//
// The server can wrap one exception in another, and repeat the markers, e.g.:
//   Code: 57. DB::Exception: There was an error on [host:9000]: Code: 57. DB::Exception: <message>. (TABLE_ALREADY_EXISTS) (version ...). (TABLE_ALREADY_EXISTS) (version ...)
//   Code: 636. DB::Exception: ... Error:\nCode: 117. DB::Exception: <message>. (INCORRECT_DATA) (version ...).\n... (CANNOT_EXTRACT_TABLE_STRUCTURE) (version ...)
// The code is the first one (of the outer exception), and so is the type: the
// last group at the end of an exception. The message is the innermost one: from
// the last `Exception: ` before the first such group.
//
// Without a group at the end of an exception (for example, an exception that the
// server writes in the middle of a streamed result), the type is the first group
// after the last `Exception: ` that has a group after it, as before.
//
// Without any group (for example, the server cuts the message of an exception
// block to fit in 16 KiB), a text that starts as a server error is an error
// without a type, and the message is the rest of the text.
//
// NOTE: In normal usage, the string fed to `parseError` comes from ClickHouse,
// but it may still include user-controlled fragments (e.g. parts of a query) or
// even non-ClickHouse payloads (proxy/HTML errors) when parsing failed requests.
// So the parser only scans the text with simple patterns and string searches:
// its time is linear in the length of the text.
const codeRe = /(?:Code|Error): (\d+)/;
// A type has at least three consecutive uppercase letters, so that groups like
// `(2)` are not mistaken for it.
const typeGroupRe = /\(([A-Z0-9_]+)\)/g;
const typeLettersRe = /[A-Z]{3}/;
const exceptionMarker = "Exception: ";
const stackTraceMarker =
  ", Stack trace (when copying this message, always include the lines below):";
const serverErrorStartRe = /^Code: \d+\. DB::\w*Exception: /;
// A sticky regex: `versionRe.lastIndex = i; versionRe.test(text)` checks for
// the marker at the position `i` only.
const versionRe = / \(version \d+\.\d+\.\d+\.\d+/y;

function hasVersionAt(text: string, index: number): boolean {
  versionRe.lastIndex = index;
  return versionRe.test(text);
}

interface TypeGroup {
  start: number;
  end: number;
  type: string;
}

function parseServerError(text: string): ParsedClickHouseError | undefined {
  const codeMatch = codeRe.exec(text);
  if (codeMatch === null) return undefined;
  const afterCode = codeMatch.index + codeMatch[0].length;
  const firstMarker = text.indexOf(exceptionMarker, afterCode);
  if (firstMarker < 0) return undefined;

  // Collect the groups that can be the type, and find the first stack trace
  // sentence, which starts right after a type: `(TYPE), Stack trace (when
  // copying ...`. The same text after a group that cannot be a type is part of
  // the message.
  let groups: TypeGroup[] = [];
  let head = text;
  let cut = -1;
  for (const m of text.matchAll(typeGroupRe)) {
    const start = m.index;
    const end = start + m[0].length;
    const type = m[1] as string;
    const canBeType = typeLettersRe.test(type);
    if (start > firstMarker + exceptionMarker.length && canBeType) {
      groups.push({ start, end, type });
    }
    if (
      cut < 0 &&
      canBeType &&
      end > afterCode &&
      text.startsWith(stackTraceMarker, end)
    ) {
      cut = end;
    }
  }
  // The server adds its stack trace sentence only when the message has no
  // `Stack trace` text, and a stack has no end group after it. So an end group
  // after the sentence means that the sentence is user text.
  if (cut >= 0) {
    const fullEnd = text.trimEnd().length;
    const laterEnd = groups.some(
      (g) => g.start >= cut && (g.end === fullEnd || hasVersionAt(text, g.end)),
    );
    if (!laterEnd) {
      head = text.slice(0, cut);
      groups = groups.filter((g) => g.end <= cut);
    }
  }
  // The message of a group starts after the last `Exception: ` before it.
  const messageStart = (g: TypeGroup) =>
    head.lastIndexOf(exceptionMarker, g.start - exceptionMarker.length) +
    exceptionMarker.length;

  // With groups at the end of an exception: the message ends at the first one,
  // and the type is the last one. Otherwise: the first group after the last
  // `Exception: ` that has a group after it.
  const textEnd = head.trimEnd().length;
  const ends = groups.filter(
    (g) => g.end === textEnd || hasVersionAt(head, g.end),
  );
  let messageEnd: TypeGroup | undefined;
  let typeGroup: TypeGroup | undefined;
  if (ends.length > 0) {
    messageEnd = ends[0];
    typeGroup = ends.at(-1);
  } else {
    const last = groups.at(-1);
    if (last === undefined) {
      if (!serverErrorStartRe.test(head)) return undefined;
      return {
        code: codeMatch[1] as string,
        message: head.slice(firstMarker + exceptionMarker.length),
        type: undefined,
      };
    }
    const from = messageStart(last);
    messageEnd = typeGroup = groups.find((g) => g.start > from);
  }
  if (messageEnd === undefined) return undefined;
  return {
    code: codeMatch[1] as string,
    message: head.slice(messageStart(messageEnd), messageEnd.start).trimEnd(),
    type: typeGroup?.type,
  };
}

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
    const parsed = parseServerError(candidate);
    if (parsed) {
      return new ClickHouseError(parsed);
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
