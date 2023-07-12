import type {
  BaseQueryParams,
  Connection,
  ConnectionParams,
  InsertParams,
  InsertResult,
  QueryResult,
} from '@clickhouse/client-common/connection'
import { getAsText } from '../utils'
import {
  getQueryId,
  isSuccessfulResponse,
  toSearchParams,
  transformUrl,
  withCompressionHeaders,
  withHttpSettings,
} from '@clickhouse/client-common/utils'
import { parseError } from '@clickhouse/client-common/error'
import type { URLSearchParams } from 'url'

export class BrowserConnection implements Connection<ReadableStream> {
  private readonly defaultHeaders: Record<string, string>
  constructor(private readonly params: ConnectionParams) {
    this.defaultHeaders = {
      Authorization: `Basic ${btoa(`${params.username}:${params.password}`)}`,
    }
  }

  async query(
    params: BaseQueryParams
  ): Promise<QueryResult<ReadableStream<Uint8Array>>> {
    const query_id = getQueryId(params.query_id)
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.params.compression.decompress_response
    )
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })
    const response = await this.request({
      body: params.query,
      params,
      searchParams,
    })
    return {
      query_id,
      stream: response.body || new ReadableStream<Uint8Array>(),
    }
  }

  async exec(params: BaseQueryParams): Promise<QueryResult<ReadableStream>> {
    const query_id = getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })
    const response = await this.request({
      body: params.query,
      params,
      searchParams,
    })
    return {
      stream: response.body || new ReadableStream<Uint8Array>(),
      query_id,
    }
  }

  async insert<T = unknown>(
    params: InsertParams<ReadableStream<T>>
  ): Promise<InsertResult> {
    const query_id = getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      query: params.query,
      session_id: params.session_id,
      query_id,
    })
    await this.request({
      body: params.values,
      params,
      searchParams,
    })
    return {
      query_id,
    }
  }

  async ping(): Promise<boolean> {
    // TODO: catch an error and just log it, returning false?
    const response = await this.request({
      method: 'GET',
      body: null,
      pathname: '/ping',
      searchParams: undefined,
    })
    if (response.body !== null) {
      await response.body.cancel()
    }
    return true
  }

  async close(): Promise<void> {
    return
  }

  private async request({
    body,
    params,
    searchParams,
    pathname,
    method,
  }: {
    body: string | ReadableStream | null
    params?: BaseQueryParams
    searchParams: URLSearchParams | undefined
    pathname?: string
    method?: 'GET' | 'POST'
  }): Promise<Response> {
    const url = transformUrl({
      url: this.params.url,
      pathname: pathname ?? '/',
      searchParams,
    }).toString()

    const abortController = new AbortController()

    let isTimedOut = false
    const timeout = setTimeout(() => {
      isTimedOut = true
      abortController.abort('Request timed out')
    }, this.params.request_timeout)

    let isAborted = false
    function onUserAbortSignal(): void {
      isAborted = true
      abortController.abort()
    }

    if (params?.abort_signal !== undefined) {
      params.abort_signal.addEventListener('abort', onUserAbortSignal, {
        once: true,
      })
    }

    try {
      const response = await fetch(url, {
        body,
        keepalive: false,
        method: method ?? 'POST',
        signal: abortController.signal,
        headers: withCompressionHeaders({
          headers: this.defaultHeaders,
          compress_request: false,
          decompress_response: this.params.compression.decompress_response,
        }),
      })
      clearTimeout(timeout)
      if (isSuccessfulResponse(response.status)) {
        return response
      } else {
        return Promise.reject(
          parseError(
            await getAsText(response.body || new ReadableStream<Uint8Array>())
          )
        )
      }
    } catch (err) {
      clearTimeout(timeout)
      if (err instanceof Error) {
        if (isAborted) {
          return Promise.reject(new Error('The user aborted a request.'))
        }
        if (isTimedOut) {
          return Promise.reject(new Error('Timeout error.'))
        }
        // maybe it's a ClickHouse error
        return Promise.reject(parseError(err))
      }
      // shouldn't happen
      throw err
    } finally {
      if (params?.abort_signal !== undefined) {
        params.abort_signal.removeEventListener('abort', onUserAbortSignal)
      }
    }
  }
}
