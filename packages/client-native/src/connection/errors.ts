import { ClickHouseError } from "../common/index";
import { errorCodeName } from "../protocol/error_codes";
import type { ServerException } from "../protocol/packets";

function stripExceptionPrefix(exception: ServerException): string {
  const prefix = exception.name + ": ";
  return exception.message.startsWith(prefix)
    ? exception.message.slice(prefix.length)
    : exception.message;
}

function formatSingleException(exception: ServerException): string {
  const type = errorCodeName(exception.code);
  const message = exception.message.startsWith(exception.name + ": ")
    ? exception.message
    : `${exception.name}: ${exception.message}`;
  return `Code: ${exception.code}. ${message}${type ? ` (${type})` : ""}`;
}

/** Makes a {@link ClickHouseError} from an Exception packet, with the same
 *  `code` and `type` as the HTTP interface gives, preserving any nested
 *  exceptions in `message` and `cause`. */
export function toClickHouseError(exception: ServerException): ClickHouseError {
  const parts = [stripExceptionPrefix(exception)];
  let nested = exception.nested;
  while (nested !== undefined) {
    parts.push(formatSingleException(nested));
    nested = nested.nested;
  }
  const error = new ClickHouseError({
    message: parts.join(": "),
    code: String(exception.code),
    type: errorCodeName(exception.code),
  });
  if (exception.nested !== undefined) {
    error.cause = toClickHouseError(exception.nested);
  }
  return error;
}

/** The text that the HTTP interface gives for an error, including any nested
 *  server exceptions. */
export function exceptionText(exception: ServerException): string {
  const parts: string[] = [];
  let current: ServerException | undefined = exception;
  while (current !== undefined) {
    parts.push(formatSingleException(current));
    current = current.nested;
  }
  return parts.join(": ") + "\n";
}
