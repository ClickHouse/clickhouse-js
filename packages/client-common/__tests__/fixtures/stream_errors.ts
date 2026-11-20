import { expect } from "vitest";

import type { QueryParamsWithFormat } from "@clickhouse/client-common";
import { ClickHouseError } from "@clickhouse/client-common";

export function streamErrorQueryParams(): QueryParamsWithFormat<"JSONEachRow"> {
  return {
    query: `SELECT toInt32(number) AS n,
                   throwIf(number = 10, 'boom') AS e,
                   sleepEachRow(0.001)
            FROM system.numbers LIMIT 100`,
    format: "JSONEachRow",
    clickhouse_settings: {
      // enforcing at least a few blocks, so that the response code is 200 OK
      max_block_size: "1",
      // Should be false by default since 25.11; but setting explicitly to make sure
      // the server configuration doesn't interfere with the test.
      http_write_exception_in_output_format: false,
    },
  };
}

export function assertError(err: Error | null) {
  expect(err).toBeInstanceOf(ClickHouseError);

  const chErr = err as ClickHouseError;
  expect(chErr.message).toContain(`boom: while executing 'FUNCTION throwIf`);
  expect(chErr.code).toBe("395");
}

/** Same as {@link streamErrorQueryParams}, but with the server writing the
 *  error as an in-band `{"exception": "..."}` row at the end of the body
 *  (the default before 25.11). See https://github.com/ClickHouse/clickhouse-js/issues/1053 */
export function inBandStreamErrorQueryParams(): QueryParamsWithFormat<"JSONEachRow"> {
  const params = streamErrorQueryParams();
  return {
    ...params,
    clickhouse_settings: {
      ...params.clickhouse_settings,
      http_write_exception_in_output_format: true,
    },
  };
}

export const inBandExceptionMessage =
  "Code: 395. DB::Exception: boom: while executing 'FUNCTION throwIf(equals(__table1.number, 10_UInt8) :: 4, 'boom'_String :: 2) -> throwIf(equals(__table1.number, 10_UInt8), 'boom'_String) UInt8 : 0'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 25.8.1.1 (official build))";

/** A `JSONEachRow` response body as written by the server when a query fails
 *  mid-stream with `http_write_exception_in_output_format` enabled: a few data
 *  rows followed by `{"exception": "<message>"}` (note the space after the colon,
 *  see `JSONUtils::writeException` in ClickHouse). */
export function inBandExceptionResponseBody(rowsBeforeError = 3): string {
  let body = "";
  for (let n = 0; n < rowsBeforeError; n++) {
    body += `{"n":${n},"e":0}\n`;
  }
  return body + `{"exception": ${JSON.stringify(inBandExceptionMessage)}}\n`;
}
