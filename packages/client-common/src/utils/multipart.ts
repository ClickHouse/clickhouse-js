import { formatQueryParams } from "../data_formatter";

export const SAFE_PART_NAME = /^[A-Za-z0-9_.-]+$/;

/**
 * Query parameters are URL-encoded into the request URL as `param_*` entries.
 * Once their encoded length passes this budget, {@link serializeQueryParamsForUrl}
 * returns null so that they are routed through the multipart body instead, keeping
 * oversized payloads out of the URL where HTTP intermediaries (nginx, AWS ALB,
 * CloudFront) reject them with HTTP 414 or 400. The threshold leaves ample
 * headroom under common request line limits.
 */
export const MAX_URL_BIND_PARAM_LENGTH = 4096;

/**
 * Early-return variant of the `param_*` serialization performed by
 * {@link toSearchParams}: serializes {@link query_params} into `param_*`
 * URL entries, returning them so the caller can reuse the result without
 * serializing the params a second time, or returns null as soon as the
 * URL-encoded length exceeds {@link MAX_URL_BIND_PARAM_LENGTH} — in which
 * case the params should be sent as a multipart/form-data body instead.
 */
export function serializeQueryParamsForUrl(
  query_params: Record<string, unknown>,
): [string, string][] | null {
  const entries: [string, string][] = [];
  // Raw length is a lower bound on the encoded length, so large payloads
  // short-circuit without materializing the encoded string.
  let rawLength = 0;
  for (const [key, value] of Object.entries(query_params)) {
    const name = `param_${key}`;
    const formatted = formatQueryParams({ value });
    rawLength += name.length + formatted.length;
    if (rawLength > MAX_URL_BIND_PARAM_LENGTH) {
      return null;
    }
    entries.push([name, formatted]);
  }
  // Measure the exact encoded length, accounting for percent-encoding expansion.
  if (
    new URLSearchParams(entries).toString().length > MAX_URL_BIND_PARAM_LENGTH
  ) {
    return null;
  }
  return entries;
}

/**
 * A binary or file-backed multipart part (used for ClickHouse external data).
 * When `filename` is set, ClickHouse's `HTMLForm` routes the part through its
 * streaming `PartHandler` instead of treating it as an in-memory form field
 * capped by `http_max_field_value_size`.
 */
export interface MultipartFilePart<Value = string | Uint8Array> {
  name: string;
  filename?: string;
  contentType?: string;
  value: Value;
}

export function validateMultipartPartName(name: string): void {
  if (!SAFE_PART_NAME.test(name)) {
    throw new Error(
      `Invalid multipart part name: "${name}". ` +
        `Part names must match ${SAFE_PART_NAME}.`,
    );
  }
}

export function formatMultipartPartHeader(
  part: {
    name: string;
    filename?: string;
    contentType?: string;
  },
  boundary: string,
): string {
  validateMultipartPartName(part.name);
  let disposition = `Content-Disposition: form-data; name="${part.name}"`;
  if (part.filename !== undefined) {
    validateMultipartPartName(part.filename);
    disposition += `; filename="${part.filename}"`;
  }
  const contentTypeLine =
    part.contentType !== undefined
      ? `Content-Type: ${part.contentType}\r\n`
      : "";
  return `--${boundary}\r\n${disposition}\r\n${contentTypeLine}\r\n`;
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
    chunks.push(formatMultipartPartHeader({ name }, boundary) + `${value}\r\n`);
  }

  chunks.push(`--${boundary}--\r\n`);

  return chunks.join("");
}

/**
 * Builds a binary `Uint8Array` multipart/form-data body from string form fields
 * and file parts (`string` or `Uint8Array`). Used when external tables are
 * sent in-memory without streaming.
 */
export function buildMultipartBytes(
  fields: Record<string, string>,
  files: ReadonlyArray<MultipartFilePart<string | Uint8Array>>,
  boundary: string,
): Uint8Array {
  const encoder = new TextEncoder();
  const segments: Uint8Array[] = [];
  let totalLength = 0;

  const pushBytes = (bytes: Uint8Array) => {
    segments.push(bytes);
    totalLength += bytes.byteLength;
  };
  const pushText = (text: string) => {
    pushBytes(encoder.encode(text));
  };
  const crlf = encoder.encode("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    pushText(formatMultipartPartHeader({ name }, boundary));
    pushText(value);
    pushBytes(crlf);
  }

  for (const file of files) {
    pushText(
      formatMultipartPartHeader(
        {
          name: file.name,
          filename: file.filename ?? file.name,
          contentType: file.contentType ?? "application/octet-stream",
        },
        boundary,
      ),
    );
    if (typeof file.value === "string") {
      pushText(file.value);
    } else {
      pushBytes(file.value);
    }
    pushBytes(crlf);
  }

  pushText(`--${boundary}--\r\n`);

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const seg of segments) {
    result.set(seg, offset);
    offset += seg.byteLength;
  }
  return result;
}
