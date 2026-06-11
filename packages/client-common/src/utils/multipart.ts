import { formatQueryParams } from "../data_formatter";

const SAFE_PART_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Query parameters are URL-encoded into the request URL as `param_*` entries.
 * Once their encoded length passes this budget, {@link queryParamsExceedUrlThreshold}
 * reports that they should be routed through the multipart body instead, keeping
 * oversized payloads out of the URL where HTTP intermediaries (nginx, AWS ALB,
 * CloudFront) reject them with HTTP 414 or 400. The threshold leaves ample
 * headroom under common request line limits.
 */
export const MAX_URL_BIND_PARAM_LENGTH = 4096;

/**
 * Returns true when the URL-encoded length of the `param_*` entries produced
 * from {@link query_params} exceeds {@link MAX_URL_BIND_PARAM_LENGTH}.
 * Used to decide whether query parameters should be auto-promoted into a
 * multipart/form-data body instead of the URL query string.
 */
export function queryParamsExceedUrlThreshold(
  query_params: Record<string, unknown>,
): boolean {
  const entries: [string, string][] = [];
  // Raw length is a lower bound on the encoded length, so large payloads
  // short-circuit without materializing the encoded string.
  let rawLength = 0;
  for (const [key, value] of Object.entries(query_params)) {
    const name = `param_${key}`;
    const formatted = formatQueryParams({ value });
    rawLength += name.length + formatted.length;
    if (rawLength > MAX_URL_BIND_PARAM_LENGTH) {
      return true;
    }
    entries.push([name, formatted]);
  }
  // Measure the exact encoded length, accounting for percent-encoding expansion.
  return (
    new URLSearchParams(entries).toString().length > MAX_URL_BIND_PARAM_LENGTH
  );
}

/**
 * Builds a multipart/form-data body from a record of named string parts.
 *
 * Example output:
 *
 *   --BOUNDARY\r\n
 *   Content-Disposition: form-data; name="query"\r\n
 *   \r\n
 *   SELECT * FROM t WHERE x IN {values:Array(String)}\r\n
 *   --BOUNDARY\r\n
 *   Content-Disposition: form-data; name="param_values"\r\n
 *   \r\n
 *   ['a@b.com','c@d.com']\r\n
 *   --BOUNDARY--\r\n
 */
export function buildMultipartBody(
  parts: Record<string, string>,
  boundary: string,
): string {
  const chunks: string[] = [];

  // Part names are validated against SAFE_PART_NAME to prevent header injection
  // (a name could otherwise smuggle CRLF or quotes into the Content-Disposition
  // line). Part values are intentionally NOT validated/escaped: the only way a
  // value could forge a part delimiter is by containing the boundary, and the
  // boundary is a random UUID generated per request by the caller, so it cannot
  // be predicted or collided with by user-supplied input.
  for (const [name, value] of Object.entries(parts)) {
    if (!SAFE_PART_NAME.test(name)) {
      throw new Error(
        `Invalid multipart part name: "${name}". ` +
          `Part names must match ${SAFE_PART_NAME}.`,
      );
    }
    chunks.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n` +
        `\r\n` +
        `${value}\r\n`,
    );
  }

  chunks.push(`--${boundary}--\r\n`);

  return chunks.join("");
}
