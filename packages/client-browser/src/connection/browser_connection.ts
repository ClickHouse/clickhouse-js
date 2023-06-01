import type {
  BaseQueryParams,
  Connection,
  ConnectionParams,
  InsertParams,
  InsertResult,
  QueryResult,
} from '@clickhouse/client-common/connection'
import { getAsText, getUserAgent } from '../utils'
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
      'User-Agent': getUserAgent(params.application_id),
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
    return Promise.resolve(true)
  }

  async close(): Promise<void> {
    return
  }

  private async request({
    body,
    params,
    searchParams,
  }: {
    body: string | ReadableStream
    params: BaseQueryParams
    searchParams: URLSearchParams | undefined
  }): Promise<Response> {
    // console.log(`signal: ${params.abort_controller?.signal?.aborted}`)
    // if (params.abort_controller?.signal?.aborted) {
    //   return Promise.reject(new Error('The request was aborted'))
    // }
    const url = transformUrl({
      url: this.params.url,
      pathname: '/',
      searchParams,
    }).toString()
    const abortController = params.abort_controller || new AbortController()
    let isTimedOut = false
    const timeout = setTimeout(() => {
      isTimedOut = true
      abortController.abort('Request timed out')
    }, this.params.request_timeout)
    try {
      const response = await fetch(url, {
        body,
        method: 'POST',
        signal: abortController.signal,
        keepalive: true,
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
    } catch (e) {
      clearTimeout(timeout)
      if (e instanceof Error) {
        if (isTimedOut) {
          // to be more in-line with the Node.js implementation
          return Promise.reject(new Error('Request timed out'))
        }
        // maybe it's a ClickHouse error
        return Promise.reject(parseError(e))
      }
      // shouldn't happen
      throw e
    }
  }
}
