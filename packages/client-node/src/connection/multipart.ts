import { formatQueryParams } from '@clickhouse/client-common'

export interface MultipartResult {
  body: Buffer
  boundary: string
}

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
}): Buffer {
  const parts: Buffer[] = []

  // Query part
  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="query"\r\n` +
        `\r\n` +
        `${query}\r\n`,
    ),
  )

  // Parameter parts
  for (const [key, value] of Object.entries(query_params)) {
    const formattedValue = formatQueryParams({ value })
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="param_${key}"\r\n` +
          `\r\n` +
          `${formattedValue}\r\n`,
      ),
    )
  }

  // Final boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`))

  return Buffer.concat(parts)
}
