import type {
  ConnBaseQueryParams,
  ConnCommandResult,
  Connection,
  ConnectionParams,
  ConnInsertParams,
  ConnInsertResult,
  ConnPingResult,
  ConnQueryResult,
  ResponseHeaders,
} from '@clickhouse/client-common'
import {
  isSuccessfulResponse,
  parseError,
  toSearchParams,
  transformUrl,
  withCompressionHeaders,
  withHttpSettings,
} from '@clickhouse/client-common'
import { getAsText } from '../utils'

type WebInsertParams<T> = Omit<
  ConnInsertParams<ReadableStream<T>>,
  'values'
> & {
  values: string
}

export type WebConnectionParams = ConnectionParams

export class WebConnection implements Connection<ReadableStream> {
  private readonly defaultHeaders: Record<string, string>
  constructor(private readonly params: WebConnectionParams) {
    this.defaultHeaders = withCompressionHeaders({
      headers: {
        Authorization: `Basic ${btoa(`${params.username}:${params.password}`)}`,
        ...params?.http_headers,
      },
      enable_request_compression: params.compression.compress_request,
      enable_response_compression: params.compression.decompress_response,
    })
  }

  async query(
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<ReadableStream<Uint8Array>>> {
    const query_id = getQueryId(params.query_id)
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.params.compression.decompress_response,
    )
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })
    const response = await this.request({
      values: params.query,
      params,
      searchParams,
    })
    return {
      query_id,
      stream: response.body || new ReadableStream<Uint8Array>(),
      response_headers: getResponseHeaders(response),
    }
  }

  async exec(
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<ReadableStream<Uint8Array>>> {
    const result = await this.runExec(params)
    return {
      query_id: result.query_id,
      stream: result.stream || new ReadableStream<Uint8Array>(),
      response_headers: result.response_headers,
    }
  }

  async command(params: ConnBaseQueryParams): Promise<ConnCommandResult> {
    const { stream, query_id, response_headers } = await this.runExec(params)
    if (stream !== null) {
      await stream.cancel()
    }
    return { query_id, response_headers }
  }

  async insert<T = unknown>(
    params: WebInsertParams<T>,
  ): Promise<ConnInsertResult> {
    const query_id = getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      query: params.query,
      session_id: params.session_id,
      query_id,
    })
    const response = await this.request({
      values: params.values,
      params,
      searchParams,
    })
    if (response.body !== null) {
      await response.text() // drain the response (it's empty anyway)
    }
    return {
      query_id,
      response_headers: getResponseHeaders(response),
    }
  }

  async ping(): Promise<ConnPingResult> {
    // ClickHouse /ping endpoint does not support CORS,
    // so we are using a simple SELECT as a workaround
    try {
      const response = await this.request({
        values: 'SELECT 1 FORMAT CSV',
      })
      if (response.body !== null) {
        await response.body.cancel()
      }
      return { success: true }
    } catch (error) {
      if (error instanceof Error) {
        return {
          success: false,
          error,
        }
      }
      throw error // should never happen
    }
  }

  async close(): Promise<void> {
    return
  }

  private async request({
    values,
    params,
    searchParams,
    pathname,
    method,
  }: {
    values: string | null
    params?: ConnBaseQueryParams
    searchParams?: URLSearchParams
    pathname?: string
    method?: 'GET' | 'POST'
  }): Promise<Response> {
    const url = transformUrl({
      url: this.params.url,
      pathname,
      searchParams,
    }).toString()

    const abortController = new AbortController()

    let isTimedOut = false
    const timeout = setTimeout(() => {
      isTimedOut = true
      abortController.abort()
    }, this.params.request_timeout)

    let isAborted = false
    if (params?.abort_signal !== undefined) {
      params.abort_signal.onabort = () => {
        isAborted = true
        abortController.abort()
      }
    }

    try {
      const headers =
        params?.auth !== undefined
          ? {
              ...this.defaultHeaders,
              Authorization: `Basic ${btoa(`${params.auth.username}:${params.auth.password}`)}`,
            }
          : this.defaultHeaders
      const response = await fetch(url, {
        body: values,
        keepalive: this.params.keep_alive.enabled,
        method: method ?? 'POST',
        signal: abortController.signal,
        headers,
      })
      clearTimeout(timeout)
      if (isSuccessfulResponse(response.status)) {
        return response
      } else {
        return Promise.reject(
          parseError(
            await getAsText(response.body || new ReadableStream<Uint8Array>()),
          ),
        )
      }
    } catch (err) {
      clearTimeout(timeout)
      if (isAborted) {
        return Promise.reject(new Error('The user aborted a request.'))
      }
      if (isTimedOut) {
        return Promise.reject(new Error('Timeout error.'))
      }
      if (err instanceof Error) {
        // maybe it's a ClickHouse error
        return Promise.reject(parseError(err))
      }
      // shouldn't happen
      throw err
    }
  }

  private async runExec(params: ConnBaseQueryParams): Promise<RunExecResult> {
    const query_id = getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })
    const response = await this.request({
      values: params.query,
      params,
      searchParams,
    })
    return {
      stream: response.body,
      response_headers: getResponseHeaders(response),
      query_id,
    }
  }
}

function getQueryId(query_id: string | undefined): string {
  return query_id || crypto.randomUUID()
}

function getResponseHeaders(response: Response): ResponseHeaders {
  const headers: ResponseHeaders = {}
  response.headers.forEach((value, key) => {
    headers[key] = value
  })
  return headers
}

interface RunExecResult {
  stream: ReadableStream<Uint8Array> | null
  query_id: string
  response_headers: ResponseHeaders
}
