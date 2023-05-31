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

export class BrowserConnection implements Connection<ReadableStream> {
  private readonly defaultHeaders: Record<string, string>
  constructor(private readonly params: ConnectionParams) {
    this.defaultHeaders = {
      Authorization: `Basic ${btoa(`${params.username}:${params.password}`)}`,
      'User-Agent': getUserAgent(params.application_id),
    }
  }

  async ping(): Promise<boolean> {
    return Promise.resolve(true)
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
    const url = transformUrl({
      url: this.params.url,
      pathname: '/',
      searchParams,
    }).toString()
    try {
      const response = await fetch(url, {
        method: 'POST',
        body: params.query,
        signal: params.abort_signal,
        headers: withCompressionHeaders({
          headers: this.defaultHeaders,
          compress_request: this.params.compression.compress_request,
          decompress_response: this.params.compression.decompress_response,
        }),
      })
      const stream = response.body || new ReadableStream<Uint8Array>()
      if (isSuccessfulResponse(response.status)) {
        return {
          query_id,
          stream,
        }
      } else {
        return Promise.reject(parseError(await getAsText(stream)))
      }
    } catch (e) {
      if (e instanceof Error) {
        // maybe it's a ClickHouse error
        return Promise.reject(parseError(e))
      }
      // shouldn't happen
      throw e
    }
  }

  async exec(params: BaseQueryParams): Promise<QueryResult<ReadableStream>> {
    throw new Error('not implemented')
  }

  async close(): Promise<void> {
    return
  }

  async insert<T = unknown>(
    params: InsertParams<ReadableStream<T>>
  ): Promise<InsertResult> {
    throw new Error('not implemented')
  }
}
