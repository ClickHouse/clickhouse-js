import type {
  ClickHouseSummary,
  ConnBaseQueryParams,
  ConnCommandParams,
  ConnCommandResult,
  Connection,
  ConnectionParams,
  ConnInsertParams,
  ConnInsertResult,
  ConnPingResult,
  ConnQueryResult,
  PreparedExternalData,
  ResponseHeaders,
} from "../common/index";
import {
  buildMultipartBody,
  buildMultipartBytes,
  serializeQueryParamsForUrl,
  formatQueryParams,
  isCredentialsAuth,
  isJWTAuth,
  isSuccessfulResponse,
  parseError,
  toSearchParams,
  transformUrl,
  withCompressionHeaders,
  withHttpSettings,
  withoutHeader,
  FORMAT_HEADER_NAME,
} from "../common/index";
import { getAsText } from "../utils";

type WebInsertParams<T> = Omit<
  ConnInsertParams<ReadableStream<T>>,
  "values"
> & {
  values: string;
};

export type WebConnectionParams = ConnectionParams & {
  fetch?: typeof fetch;
};

export class WebConnection implements Connection<ReadableStream> {
  private readonly defaultAuthHeader: string;
  private readonly params: WebConnectionParams;
  constructor(params: WebConnectionParams) {
    this.params = params;
    if (params.auth.type === "JWT") {
      this.defaultAuthHeader = `Bearer ${params.auth.access_token}`;
    } else if (params.auth.type === "Credentials") {
      this.defaultAuthHeader = `Basic ${btoa(`${params.auth.username}:${params.auth.password}`)}`;
    } else {
      throw new Error(`Unknown auth type: ${(params.auth as any).type}`);
    }
  }

  async query(
    params: ConnBaseQueryParams<ReadableStream>,
  ): Promise<ConnQueryResult<ReadableStream<Uint8Array>>> {
    const query_id = getQueryId(params.query_id);
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.params.compression.decompress_response,
    );

    const externalData = params.external_data;
    const hasExternalData =
      externalData !== undefined && externalData.length > 0;
    const queryParams = params.query_params;
    const hasQueryParams =
      queryParams !== undefined && Object.keys(queryParams).length > 0;
    let useMultipartParams =
      hasQueryParams &&
      (params.use_multipart_params ?? this.params.use_multipart_params);
    // In auto mode, serialize the params for the URL once with an early
    // return: a null result means they exceed the URL budget and should be
    // promoted to a multipart body; otherwise the entries are reused below.
    let urlParamEntries: [string, string][] | undefined;
    if (
      hasQueryParams &&
      !useMultipartParams &&
      (params.use_multipart_params_auto ??
        this.params.use_multipart_params_auto)
    ) {
      const entries = serializeQueryParamsForUrl(queryParams);
      if (entries === null) {
        useMultipartParams = true;
      } else {
        urlParamEntries = entries;
      }
    }

    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings,
      query_params: useMultipartParams ? undefined : params.query_params,
      param_entries: urlParamEntries,
      external_data: hasExternalData ? externalData : undefined,
      session_id: params.session_id,
      role: params.role,
      query_id,
    });

    let body: string | Uint8Array<ArrayBuffer> = params.query;
    // The `default_format` setting gives the format of a query(). The server
    // uses a custom `X-ClickHouse-Format` header instead of that setting.
    // For this reason, the client does not send the header.
    let headers = withoutHeader(
      this.defaultHeadersWithOverride(params),
      FORMAT_HEADER_NAME,
    );
    if (hasExternalData) {
      const boundary = `----clickhouse-js-${crypto.randomUUID()}`;
      const fields: Record<string, string> = { query: params.query };
      if (useMultipartParams && params.query_params !== undefined) {
        for (const [key, value] of Object.entries(params.query_params)) {
          fields[`param_${key}`] = formatQueryParams({ value });
        }
      }
      body = buildWebExternalMultipartBody(fields, externalData, boundary);
      headers = withMultipartContentType(headers, boundary);
    } else if (useMultipartParams && params.query_params !== undefined) {
      const boundary = `----clickhouse-js-${crypto.randomUUID()}`;
      const multipartParts: Record<string, string> = { query: params.query };
      for (const [key, value] of Object.entries(params.query_params)) {
        multipartParts[`param_${key}`] = formatQueryParams({ value });
      }
      body = buildMultipartBody(multipartParts, boundary);
      headers = withMultipartContentType(headers, boundary);
    }

    const response = await this.request({
      body,
      params,
      searchParams,
      headers,
    });
    return {
      query_id,
      stream: response.body || new ReadableStream<Uint8Array>(),
      summary: this.getSummary(response),
      response_headers: getResponseHeaders(response),
      http_status_code: response.status,
    };
  }

  async exec(
    params: ConnBaseQueryParams<ReadableStream>,
  ): Promise<ConnQueryResult<ReadableStream<Uint8Array>>> {
    const result = await this.runExec(params);
    return {
      query_id: result.query_id,
      stream: result.stream || new ReadableStream<Uint8Array>(),
      summary: result.summary,
      response_headers: result.response_headers,
      http_status_code: result.http_status_code,
    };
  }

  async command(
    params: ConnCommandParams<ReadableStream>,
  ): Promise<ConnCommandResult> {
    const { stream, query_id, summary, response_headers, http_status_code } =
      await this.runExec(params);
    if (stream !== null) {
      await stream.cancel();
    }
    return { query_id, summary, response_headers, http_status_code };
  }

  async insert<T = unknown>(
    params: WebInsertParams<T>,
  ): Promise<ConnInsertResult> {
    const query_id = getQueryId(params.query_id);
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      query: params.query,
      session_id: params.session_id,
      role: params.role,
      query_id,
    });
    const response = await this.request({
      body: params.values,
      params,
      searchParams,
    });
    if (response.body !== null) {
      await response.text(); // drain the response (it's empty anyway)
    }
    return {
      query_id,
      summary: this.getSummary(response),
      response_headers: getResponseHeaders(response),
      http_status_code: response.status,
    };
  }

  async ping(): Promise<ConnPingResult> {
    // ClickHouse /ping endpoint does not support CORS,
    // so we are using a simple SELECT as a workaround
    try {
      const response = await this.request({
        body: null,
        searchParams: toSearchParams({
          database: undefined,
          query: `SELECT 'ping'`,
          query_id: getQueryId(undefined),
        }),
        method: "GET",
      });
      if (response.body !== null) {
        await response.body.cancel();
      }
      return { success: true };
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          error,
        };
      }
      throw error; // should never happen
    }
  }

  async close(): Promise<void> {
    return;
  }

  private async request({
    body,
    params,
    searchParams,
    pathname,
    method,
    headers: prebuiltHeaders,
  }: {
    body: BodyInit | null;
    params?: ConnBaseQueryParams<ReadableStream>;
    searchParams?: URLSearchParams;
    pathname?: string;
    method?: "GET" | "POST";
    headers?: Record<string, string>;
  }): Promise<Response> {
    const url = transformUrl({
      url: this.params.url,
      pathname,
      searchParams,
    }).toString();

    const abortController = new AbortController();

    let isTimedOut = false;
    const timeout = setTimeout(() => {
      isTimedOut = true;
      abortController.abort();
    }, this.params.request_timeout);

    let isAborted = false;
    if (params?.abort_signal !== undefined) {
      params.abort_signal.onabort = () => {
        isAborted = true;
        abortController.abort();
      };
    }

    try {
      const headers = withCompressionHeaders({
        headers: prebuiltHeaders ?? this.defaultHeadersWithOverride(params),
        // It is not currently working as expected in all major browsers
        request_compression_codec: undefined,
        response_compression_codec:
          this.params.compression.decompress_response?.codec,
      });

      // avoiding "fetch called on an object that does not implement interface Window" error
      const fetchFn = this.params.fetch ?? fetch;
      const response = await fetchFn(url, {
        body,
        headers,
        keepalive: this.params.keep_alive.enabled && bodyFitsKeepAlive(body),
        method: method ?? "POST",
        signal: abortController.signal,
      });
      clearTimeout(timeout);
      if (
        isSuccessfulResponse(response.status) &&
        !response.headers.has("x-clickhouse-exception-code")
      ) {
        return response;
      } else {
        return Promise.reject(
          parseError(
            await getAsText(response.body || new ReadableStream<Uint8Array>()),
          ),
        );
      }
    } catch (err) {
      clearTimeout(timeout);
      if (isAborted) {
        return Promise.reject(new Error("The user aborted a request."));
      }
      if (isTimedOut) {
        return Promise.reject(new Error("Timeout error."));
      }
      if (err instanceof Error) {
        // maybe it's a ClickHouse error
        return Promise.reject(parseError(err));
      }
      // shouldn't happen
      throw err;
    }
  }

  private async runExec(
    params: ConnBaseQueryParams<ReadableStream>,
  ): Promise<RunExecResult> {
    const query_id = getQueryId(params.query_id);
    const externalData = params.external_data;
    const hasExternalData =
      externalData !== undefined && externalData.length > 0;
    const queryParams = params.query_params;
    const hasQueryParams =
      queryParams !== undefined && Object.keys(queryParams).length > 0;
    let useMultipartParams =
      hasExternalData &&
      hasQueryParams &&
      (params.use_multipart_params ?? this.params.use_multipart_params);
    let urlParamEntries: [string, string][] | undefined;
    if (
      hasExternalData &&
      hasQueryParams &&
      !useMultipartParams &&
      (params.use_multipart_params_auto ??
        this.params.use_multipart_params_auto)
    ) {
      const entries = serializeQueryParamsForUrl(queryParams);
      if (entries === null) {
        useMultipartParams = true;
      } else {
        urlParamEntries = entries;
      }
    }

    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: useMultipartParams ? undefined : params.query_params,
      param_entries: urlParamEntries,
      external_data: hasExternalData ? externalData : undefined,
      session_id: params.session_id,
      role: params.role,
      query_id,
    });
    let body: string | Uint8Array<ArrayBuffer> = params.query;
    let headers: Record<string, string> | undefined;
    if (hasExternalData) {
      const boundary = `----clickhouse-js-${crypto.randomUUID()}`;
      const fields: Record<string, string> = { query: params.query };
      if (useMultipartParams && params.query_params !== undefined) {
        for (const [key, value] of Object.entries(params.query_params)) {
          fields[`param_${key}`] = formatQueryParams({ value });
        }
      }
      body = buildWebExternalMultipartBody(fields, externalData, boundary);
      headers = withMultipartContentType(
        this.defaultHeadersWithOverride(params),
        boundary,
      );
    }

    const response = await this.request({
      body,
      params,
      searchParams,
      headers,
    });
    return {
      stream: response.body,
      summary: this.getSummary(response),
      response_headers: getResponseHeaders(response),
      query_id,
      http_status_code: response.status,
    };
  }

  /** Parse the `X-ClickHouse-Summary` response header into a
   *  {@link ClickHouseSummary}, or `undefined` if the header is absent or
   *  cannot be parsed. Parsing failures are logged and swallowed - the summary
   *  is optional diagnostic metadata and must never fail a request. */
  private getSummary(response: Response): ClickHouseSummary | undefined {
    const summaryHeader = response.headers.get("x-clickhouse-summary");
    if (summaryHeader === null) {
      return undefined;
    }
    const parse = this.params.json?.parse ?? JSON.parse;
    try {
      return parse(summaryHeader) as ClickHouseSummary;
    } catch (err) {
      this.params.log_writer.warn({
        module: "WebConnection",
        message: "Failed to parse X-ClickHouse-Summary header.",
        args: {
          "X-ClickHouse-Summary": summaryHeader,
          error: String(err),
        },
      });
      return undefined;
    }
  }

  private defaultHeadersWithOverride(
    params?: ConnBaseQueryParams<ReadableStream>,
  ): Record<string, string> {
    let authHeader: string;
    if (isJWTAuth(params?.auth)) {
      authHeader = `Bearer ${params?.auth.access_token}`;
    } else if (isCredentialsAuth(params?.auth)) {
      authHeader = `Basic ${btoa(`${params?.auth.username}:${params?.auth.password}`)}`;
    } else {
      authHeader = this.defaultAuthHeader;
    }
    return {
      // Custom HTTP headers from the client configuration
      ...(this.params.http_headers ?? {}),
      // Custom HTTP headers for this particular request; it will override the client configuration with the same keys
      ...(params?.http_headers ?? {}),
      Authorization: authHeader,
    };
  }
}

// Fetch joins header names that differ only in case into one value. Thus, a
// custom `content-type` header in another case would make the multipart
// `Content-Type` invalid; remove every case variant first.
function withMultipartContentType(
  headers: Record<string, string>,
  boundary: string,
): Record<string, string> {
  return {
    ...withoutHeader(headers, "Content-Type"),
    "Content-Type": `multipart/form-data; boundary=${boundary}`,
  };
}

function buildWebExternalMultipartBody(
  fields: Record<string, string>,
  externalData: ReadonlyArray<PreparedExternalData<ReadableStream>>,
  boundary: string,
): Uint8Array<ArrayBuffer> {
  return buildMultipartBytes(
    fields,
    externalData.map((ext) => ({
      name: ext.name,
      filename: ext.name,
      contentType: "application/octet-stream",
      value: ext.data as string | Uint8Array,
    })),
    boundary,
  ) as Uint8Array<ArrayBuffer>;
}

// Browsers reject a fetch() request that has `keepalive: true` and a body
// larger than 64 KiB ("TypeError: Failed to fetch").
const MAX_KEEPALIVE_BODY_BYTES = 64 * 1024;

function bodyFitsKeepAlive(body: BodyInit | null): boolean {
  if (body === null) {
    return true;
  }
  if (typeof body === "string") {
    // UTF-8 uses 1 to 3 bytes for each UTF-16 code unit; the client encodes
    // the string only when its length does not give the answer.
    if (body.length > MAX_KEEPALIVE_BODY_BYTES) {
      return false;
    }
    if (body.length * 3 <= MAX_KEEPALIVE_BODY_BYTES) {
      return true;
    }
    return (
      new TextEncoder().encode(body).byteLength <= MAX_KEEPALIVE_BODY_BYTES
    );
  }
  if (body instanceof Uint8Array) {
    return body.byteLength <= MAX_KEEPALIVE_BODY_BYTES;
  }
  return false;
}

function getQueryId(query_id: string | undefined): string {
  return query_id || crypto.randomUUID();
}

function getResponseHeaders(response: Response): ResponseHeaders {
  const headers: ResponseHeaders = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return headers;
}

interface RunExecResult {
  stream: ReadableStream<Uint8Array> | null;
  query_id: string;
  summary?: ClickHouseSummary;
  response_headers: ResponseHeaders;
  http_status_code: number;
}
