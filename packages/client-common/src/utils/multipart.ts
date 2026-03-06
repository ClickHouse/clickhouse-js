import { formatQueryParams } from '../data_formatter'

const SAFE_PARAM_NAME = /^[A-Za-z0-9_]+$/

/**
 * Builds a multipart/form-data body containing the SQL query and
 * formatted query parameters as named parts.
 *
 * The resulting body follows the format expected by ClickHouse's HTTP interface:
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
export function buildMultipartBody({
  query,
  query_params,
  boundary,
}: {
  query: string
  query_params: Record<string, unknown>
  boundary: string
}): string {
  const parts: string[] = []

  // Query part
  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="query"\r\n` +
      `\r\n` +
      `${query}\r\n`,
  )

  // Parameter parts
  for (const [key, value] of Object.entries(query_params)) {
    if (!SAFE_PARAM_NAME.test(key)) {
      throw new Error(
        `Invalid query parameter name: "${key}". ` +
          'Parameter names must match /^[A-Za-z0-9_]+$/.',
      )
    }
    const formattedValue = formatQueryParams({ value })
    parts.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="param_${key}"\r\n` +
        `\r\n` +
        `${formattedValue}\r\n`,
    )
  }

  // Final boundary
  parts.push(`--${boundary}--\r\n`)

  return parts.join('')
}
