import type { Readable } from "stream";
import Stream from "stream";

import type { Logger } from "../../logger";

import type { BaseParams, Connection, ConnectionParams, InsertParams, InsertResult, QueryResult } from "../connection";
import { toSearchParams } from "./http_search_params";
import { transformUrl } from "./transform_url";
import { getAsText, isStream } from "../../utils";
import type { ClickHouseSettings } from "../../settings";
import { getUserAgent } from "../../utils/user_agent";
import * as uuid from "uuid";
import type { Response as FetchResponse } from "node-fetch";
import { parseError } from "../../error";
import type * as http from "http";

// @ts-ignore
const fetch = (...args) =>
  // @ts-ignore
  import('node-fetch').then(({ default: fetch }) => fetch(...args))

export interface RequestParams {
  method: 'GET' | 'POST'
  url: URL
  body?: string | NodeJS.ReadableStream
  abort_signal?: AbortSignal
  decompress_response?: boolean
  compress_request?: boolean
}

function isSuccessfulResponse(statusCode?: number): boolean {
  return Boolean(statusCode && 200 <= statusCode && statusCode < 300)
}

// function isEventTarget(signal: any): signal is EventTarget {
//   return 'removeEventListener' in signal
// }

function withHttpSettings(
  clickhouse_settings?: ClickHouseSettings,
  compression?: boolean
): ClickHouseSettings {
  return {
    ...(compression
      ? {
          enable_http_compression: 1,
        }
      : {}),
    ...clickhouse_settings,
  }
}

export abstract class BaseHttpAdapter implements Connection {
  protected readonly headers: Record<string, string>

  protected constructor(
    protected readonly config: ConnectionParams,
    private readonly logger: Logger,
    protected readonly agent: http.Agent
  ) {
    this.headers = this.buildDefaultHeaders(config.username, config.password)
  }

  protected buildDefaultHeaders(
    username: string,
    password: string
  ): Record<string, string> {
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        'base64'
      )}`,
      'User-Agent': getUserAgent(this.config.application_id),
    }
  }

  protected clientRequest(
    params: RequestParams,
    requestStream: Readable | undefined,
    headers: Record<string, string>
  ): Promise<FetchResponse> {
    return fetch(params.url, {
      method: params.method,
      agent: this.agent,
      signal: params.abort_signal,
      body: requestStream,
      headers,
    })
  }

  protected async request(params: RequestParams): Promise<Stream.Readable> {
    const requestStream =
      params.body !== undefined
        ? isStream(params.body)
          ? params.body
          : Stream.Readable.from([params.body])
        : undefined
    const requestHeaders = this.getHeaders(params)
    const startTimestamp = Date.now()
    const response = await this.clientRequest(
      params,
      requestStream,
      requestHeaders
    )
    this.logResponse(requestHeaders, params, response, startTimestamp)
    if (isSuccessfulResponse(response.status)) {
      const stream = new Stream.Readable()
      return response.body === null ? stream : stream.wrap(response.body)
    } else {
      throw parseError(await getAsText(response.body))
    }

    //   function onTimeout(): void {
    //     removeRequestListeners()
    //     request.once('error', function () {
    //       /**
    //        * catch "Error: ECONNRESET" error which shouldn't be reported to users.
    //        * see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
    //        * */
    //     })
    //     request.destroy()
    //     reject(new Error('Timeout error'))
    //   }

    //   function onClose(): void {
    //     // Adapter uses 'close' event to clean up listeners after the successful response.
    //     // It's necessary in order to handle 'abort' and 'timeout' events while response is streamed.
    //     // It's always the last event, according to https://nodejs.org/docs/latest-v14.x/api/http.html#http_http_request_url_options_callback
    //     removeRequestListeners()
    //   }
    //
    //   function removeRequestListeners(): void {
    //     request.removeListener('response', onResponse)
    //     request.removeListener('error', onError)
    //     request.removeListener('timeout', onTimeout)
    //     request.removeListener('abort', onAbort)
    //     request.removeListener('close', onClose)
    //     if (params.abort_signal !== undefined) {
    //       if (isEventTarget(params.abort_signal)) {
    //         params.abort_signal.removeEventListener('abort', onAbortSignal)
    //       } else {
    //         // @ts-expect-error if it's EventEmitter
    //         params.abort_signal.removeListener('abort', onAbortSignal)
    //       }
    //     }
    //   }
    //
    //   request.on('response', onResponse)
    //   request.on('timeout', onTimeout)
    //   request.on('error', onError)
    //   request.on('abort', onAbort)
    //   request.on('close', onClose)
  }

  async ping(): Promise<boolean> {
    // TODO add status code check
    const stream = await this.request({
      method: 'GET',
      url: transformUrl({ url: this.config.url, pathname: '/ping' }),
    })
    stream.destroy()
    return true
  }

  async query(params: BaseParams): Promise<QueryResult> {
    const query_id = this.getQueryId(params)
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.config.compression.decompress_response
    )
    const searchParams = toSearchParams({
      database: this.config.database,
      clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })

    const stream = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.config.url, pathname: '/', searchParams }),
      body: params.query,
      abort_signal: params.abort_signal,
      decompress_response: clickhouse_settings.enable_http_compression === 1,
    })

    return {
      stream,
      query_id,
    }
  }

  async exec(params: BaseParams): Promise<QueryResult> {
    const query_id = this.getQueryId(params)
    const searchParams = toSearchParams({
      database: this.config.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })

    const stream = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.config.url, pathname: '/', searchParams }),
      body: params.query,
      abort_signal: params.abort_signal,
    })

    return {
      stream,
      query_id,
    }
  }

  async insert(params: InsertParams): Promise<InsertResult> {
    const query_id = this.getQueryId(params)
    const searchParams = toSearchParams({
      database: this.config.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      query: params.query,
      session_id: params.session_id,
      query_id,
    })

    await this.request({
      method: 'POST',
      url: transformUrl({ url: this.config.url, pathname: '/', searchParams }),
      body: params.values,
      abort_signal: params.abort_signal,
      compress_request: this.config.compression.compress_request,
    })

    return { query_id }
  }

  async close(): Promise<void> {
    if (this.agent !== undefined && this.agent.destroy !== undefined) {
      this.agent.destroy()
    }
  }

  private getQueryId(params: BaseParams): string {
    return params.query_id || uuid.v4()
  }

  private logResponse(
    requestHeaders: Record<string, string>,
    params: RequestParams,
    response: FetchResponse,
    startTimestamp: number
  ) {
    // Exclude `authentication` and `host` headers from logs
    const headers = Object.entries(requestHeaders).filter(([k]) => {
      const lower = k.toLowerCase()
      return lower !== 'authorization' && lower !== 'host'
    })
    const duration = Date.now() - startTimestamp
    this.logger.debug({
      module: 'HTTP Adapter',
      message: 'Got a response from ClickHouse',
      args: {
        request_method: params.method,
        request_path: params.url.pathname,
        request_params: params.url.search,
        request_headers: headers,
        response_status: response.status,
        response_headers: response.headers,
        response_time_ms: duration,
      },
    })
  }

  protected getHeaders(params: RequestParams) {
    return {
      ...this.headers,
      ...(params.decompress_response ? { 'Accept-Encoding': 'gzip' } : {}),
      ...(params.compress_request ? { 'Content-Encoding': 'gzip' } : {}),
    }
  }
}
