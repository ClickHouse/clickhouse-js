const SAFE_PART_NAME = /^[A-Za-z0-9_.-]+$/

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
  const chunks: string[] = []

  for (const [name, value] of Object.entries(parts)) {
    if (!SAFE_PART_NAME.test(name)) {
      throw new Error(
        `Invalid multipart part name: "${name}". ` +
          `Part names must match ${SAFE_PART_NAME}.`,
      )
    }
    chunks.push(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${name}"\r\n` +
        `\r\n` +
        `${value}\r\n`,
    )
  }

  chunks.push(`--${boundary}--\r\n`)

  return chunks.join('')
}
