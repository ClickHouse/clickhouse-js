import type {
  ConnBaseQueryParams,
  Connection,
  ConnectionParams,
  ConnInsertParams,
  ConnInsertResult,
  ConnPingResult,
  ConnQueryResult,
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
    this.defaultHeaders = {
      Authorization: `Basic ${btoa(`${params.username}:${params.password}`)}`,
      ...params?.http_headers,
    }
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
    }
  }

  async exec(
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<ReadableStream<Uint8Array>>> {
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
      stream: response.body || new ReadableStream<Uint8Array>(),
      query_id,
    }
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
    const res = await this.request({
      values: params.values,
      params,
      searchParams,
    })
    if (res.body !== null) {
      await res.text() // drain the response (it's empty anyway)
    }
    return {
      query_id,
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
      const headers = withCompressionHeaders({
        headers: this.defaultHeaders,
        compress_request: false,
        decompress_response: this.params.compression.decompress_response,
      })
      const response = await fetch(url, {
        body: values,
        headers,
        keepalive: this.params.keep_alive.enabled,
        method: method ?? 'POST',
        signal: abortController.signal,
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
}

function getQueryId(query_id: string | undefined): string {
  return query_id || crypto.randomUUID()
}
