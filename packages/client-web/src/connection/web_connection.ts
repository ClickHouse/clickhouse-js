import type {
  ClickHouseSummary,
  ConnBaseQueryParams,
  ConnCommandResult,
  Connection,
  ConnectionParams,
  ConnInsertParams,
  ConnInsertResult,
  ConnPingResult,
  ConnQueryResult,
  ResponseHeaders,
} from "../common/index";
import {
  buildMultipartBody,
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
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<ReadableStream<Uint8Array>>> {
    const query_id = getQueryId(params.query_id);
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.params.compression.decompress_response,
    );

    const queryParams = params.query_params;
    const hasQueryParams =
      queryParams !== undefined && Object.keys(queryParams).length > 0;
    let useMultipart =
      hasQueryParams &&
      (params.use_multipart_params ?? this.params.use_multipart_params);
    // In auto mode, serialize the params for the URL once with an early
    // return: a null result means they exceed the URL budget and should be
    // promoted to a multipart body; otherwise the entries are reused below.
    let urlParamEntries: [string, string][] | undefined;
    if (
      hasQueryParams &&
      !useMultipart &&
      (params.use_multipart_params_auto ??
        this.params.use_multipart_params_auto)
    ) {
      const entries = serializeQueryParamsForUrl(queryParams);
      if (entries === null) {
        useMultipart = true;
      } else {
        urlParamEntries = entries;
      }
    }

    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings,
      query_params: useMultipart ? undefined : params.query_params,
      param_entries: urlParamEntries,
      session_id: params.session_id,
      role: params.role,
      query_id,
    });

    let body: string = params.query;
    // The `default_format` setting gives the format of a query(). The server
    // uses a custom `X-ClickHouse-Format` header instead of that setting.
    // For this reason, the client does not send the header.
    const headers = withoutHeader(
      this.defaultHeadersWithOverride(params),
      FORMAT_HEADER_NAME,
    );
    if (useMultipart && params.query_params !== undefined) {
      const boundary = `----clickhouse-js-${crypto.randomUUID()}`;
      const multipartParts: Record<string, string> = { query: params.query };
      for (const [key, value] of Object.entries(params.query_params)) {
        multipartParts[`param_${key}`] = formatQueryParams({ value });
      }
      body = buildMultipartBody(multipartParts, boundary);
      headers["Content-Type"] = `multipart/form-data; boundary=${boundary}`;
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
    params: ConnBaseQueryParams,
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

  async command(params: ConnBaseQueryParams): Promise<ConnCommandResult> {
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
    body: string | null;
    params?: ConnBaseQueryParams;
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

    // `onabort` holds one handler. A second request, or the caller, would
    // replace it, so abort() would cancel only the last request. A signal
    // can have many listeners: subscribe, and remove that listener when
    // this request is finished.
    let isAborted = false;
    const abortSignal = params?.abort_signal;
    let removeAbortListener: (() => void) | undefined;
    if (abortSignal !== undefined) {
      let removed = false;
      const onAbort = () => {
        isAborted = true;
        abortController.abort();
        removeAbortListener?.();
      };
      removeAbortListener = () => {
        if (removed) {
          return;
        }
        removed = true;
        abortSignal.removeEventListener("abort", onAbort);
      };
      abortSignal.addEventListener("abort", onAbort);
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
        keepalive: this.params.keep_alive.enabled,
        method: method ?? "POST",
        signal: abortController.signal,
      });
      clearTimeout(timeout);
      if (
        isSuccessfulResponse(response.status) &&
        !response.headers.has("x-clickhouse-exception-code")
      ) {
        // query() and exec() return the body. An abort while the caller
        // reads it must still cancel that read, so keep the listener until
        // the body ends.
        if (
          abortSignal === undefined ||
          response.body === null ||
          removeAbortListener === undefined
        ) {
          removeAbortListener?.();
          return response;
        }
        return responseWithBodyThatReleases(
          response,
          response.body,
          removeAbortListener,
        );
      } else {
        const errorBody = await getAsText(
          response.body || new ReadableStream<Uint8Array>(),
        );
        removeAbortListener?.();
        return Promise.reject(parseError(errorBody));
      }
    } catch (err) {
      clearTimeout(timeout);
      removeAbortListener?.();
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

  private async runExec(params: ConnBaseQueryParams): Promise<RunExecResult> {
    const query_id = getQueryId(params.query_id);
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      role: params.role,
      query_id,
    });
    const response = await this.request({
      body: params.query,
      params,
      searchParams,
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
    params?: ConnBaseQueryParams,
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

function getQueryId(query_id: string | undefined): string {
  return query_id || crypto.randomUUID();
}

/** Forward `body` and call `release` when it ends, fails, or is cancelled.
 *  The listener stays in place while the caller reads the body. */
function bodyThatReleasesOnSettle(
  body: ReadableStream<Uint8Array>,
  release: () => void,
): ReadableStream<Uint8Array> {
  let released = false;
  const finish = () => {
    if (released) {
      return;
    }
    released = true;
    release();
  };
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          finish();
          controller.close();
          return;
        }
        controller.enqueue(value);
      } catch (err) {
        finish();
        controller.error(err);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason);
    },
  });
}

function responseWithBodyThatReleases(
  response: Response,
  body: ReadableStream<Uint8Array>,
  release: () => void,
): Response {
  return new Response(bodyThatReleasesOnSettle(body, release), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
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
