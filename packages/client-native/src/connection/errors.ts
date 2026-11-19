import { ClickHouseError } from "../common/index";
import { errorCodeName } from "../protocol/error_codes";
import type { ServerException } from "../protocol/packets";

/** Makes a {@link ClickHouseError} from an Exception packet, with the same
 *  `code` and `type` as the HTTP interface gives. */
export function toClickHouseError(exception: ServerException): ClickHouseError {
  const prefix = exception.name + ": ";
  const message = exception.message.startsWith(prefix)
    ? exception.message.slice(prefix.length)
    : exception.message;
  return new ClickHouseError({
    message,
    code: String(exception.code),
    type: errorCodeName(exception.code),
  });
}
