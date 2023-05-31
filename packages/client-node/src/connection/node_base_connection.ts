import Stream from 'stream'
import type Http from 'http'
import Zlib from 'zlib'
import { parseError } from '@clickhouse/client-common/error'

import type {
  BaseQueryParams,
  Connection,
  ConnectionParams,
  InsertParams,
  InsertResult,
  QueryResult,
} from '@clickhouse/client-common/connection'
import {
  getQueryId,
  isSuccessfulResponse,
  toSearchParams,
  transformUrl,
  withHttpSettings,
} from '@clickhouse/client-common/utils'
import { getAsText, getUserAgent, isStream } from '../utils'

export type NodeConnectionParams = ConnectionParams & { tls?: TLSParams }
export type TLSParams =
  | {
      ca_cert: Buffer
      type: 'Basic'
    }
  | {
      ca_cert: Buffer
      cert: Buffer
      key: Buffer
      type: 'Mutual'
    }

export interface RequestParams {
  method: 'GET' | 'POST'
  url: URL
  body?: string | Stream.Readable
  abort_signal?: AbortSignal
  decompress_response?: boolean
  compress_request?: boolean
}

export abstract class NodeBaseConnection
  implements Connection<Stream.Readable>
{
  protected readonly headers: Http.OutgoingHttpHeaders
  protected constructor(
    protected readonly params: NodeConnectionParams,
    protected readonly agent: Http.Agent
  ) {
    this.headers = this.buildDefaultHeaders(params.username, params.password)
  }

  protected buildDefaultHeaders(
    username: string,
    password: string
  ): Http.OutgoingHttpHeaders {
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        'base64'
      )}`,
      'User-Agent': getUserAgent(this.params.application_id),
    }
  }

  protected abstract createClientRequest(
    url: URL,
    params: RequestParams
  ): Http.ClientRequest

  protected async request(params: RequestParams): Promise<Stream.Readable> {
    return new Promise((resolve, reject) => {
      const start = Date.now()

      const request = this.createClientRequest(params.url, params)
      request.once('socket', (socket) => {
        socket.setTimeout(this.params.request_timeout)
      })
      function onError(err: Error): void {
        removeRequestListeners()
        reject(err)
      }

      const onResponse = async (
        _response: Http.IncomingMessage
      ): Promise<void> => {
        this.logResponse(request, params, _response, start)

        const decompressionResult = decompressResponse(_response)

        if (isDecompressionError(decompressionResult)) {
          return reject(decompressionResult.error)
        }

        if (isSuccessfulResponse(_response.statusCode)) {
          return resolve(decompressionResult.response)
        } else {
          reject(parseError(await getAsText(decompressionResult.response)))
        }
      }

      function onTimeout(): void {
        removeRequestListeners()
        request.once('error', function () {
          /**
           * catch "Error: ECONNRESET" error which shouldn't be reported to users.
           * see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
           * */
        })
        request.destroy()
        reject(new Error('Timeout error'))
      }

      function onAbortSignal(): void {
        // instead of deprecated request.abort()
        request.destroy(new Error('The request was aborted.'))
      }

      function onAbort(): void {
        // Prefer 'abort' event since it always triggered unlike 'error' and 'close'
        // see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
        removeRequestListeners()
        request.once('error', function () {
          /**
           * catch "Error: ECONNRESET" error which shouldn't be reported to users.
           * see the full sequence of events https://nodejs.org/api/http.html#httprequesturl-options-callback
           * */
        })
        reject(new Error('The request was aborted.'))
      }

      function onClose(): void {
        // Adapter uses 'close' event to clean up listeners after the successful response.
        // It's necessary in order to handle 'abort' and 'timeout' events while response is streamed.
        // It's always the last event, according to https://nodejs.org/docs/latest-v14.x/api/http.html#http_http_request_url_options_callback
        removeRequestListeners()
      }

      function removeRequestListeners(): void {
        request.removeListener('response', onResponse)
        request.removeListener('error', onError)
        request.removeListener('timeout', onTimeout)
        request.removeListener('abort', onAbort)
        request.removeListener('close', onClose)
        if (params.abort_signal !== undefined) {
          if (isEventTarget(params.abort_signal)) {
            params.abort_signal.removeEventListener('abort', onAbortSignal)
          } else {
            // @ts-expect-error if it's EventEmitter
            params.abort_signal.removeListener('abort', onAbortSignal)
          }
        }
      }

      if (params.abort_signal) {
        // We should use signal API when nodejs v14 is not supported anymore.
        // However, it seems that Http.request doesn't abort after 'response' event.
        // Requires an additional investigation
        // https://nodejs.org/api/globals.html#class-abortsignal
        params.abort_signal.addEventListener('abort', onAbortSignal, {
          once: true,
        })
      }

      request.on('response', onResponse)
      request.on('timeout', onTimeout)
      request.on('error', onError)
      request.on('abort', onAbort)
      request.on('close', onClose)

      if (!params.body) return request.end()

      const bodyStream = isStream(params.body)
        ? params.body
        : Stream.Readable.from([params.body])

      const callback = (err: NodeJS.ErrnoException | null): void => {
        if (err) {
          removeRequestListeners()
          reject(err)
        }
      }

      if (params.compress_request) {
        Stream.pipeline(bodyStream, Zlib.createGzip(), request, callback)
      } else {
        Stream.pipeline(bodyStream, request, callback)
      }
    })
  }

  async ping(): Promise<boolean> {
    // TODO add status code check
    const stream = await this.request({
      method: 'GET',
      url: transformUrl({ url: this.params.url, pathname: '/ping' }),
    })
    stream.destroy()
    return true
  }

  async query(params: BaseQueryParams): Promise<QueryResult<Stream.Readable>> {
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

    const stream = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.params.url, pathname: '/', searchParams }),
      body: params.query,
      abort_signal: params.abort_signal,
      decompress_response: clickhouse_settings.enable_http_compression === 1,
    })

    return {
      stream,
      query_id,
    }
  }

  async exec(params: BaseQueryParams): Promise<QueryResult<Stream.Readable>> {
    const query_id = getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })

    const stream = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.params.url, pathname: '/', searchParams }),
      body: params.query,
      abort_signal: params.abort_signal,
    })

    return {
      stream,
      query_id,
    }
  }

  async insert(params: InsertParams<Stream.Readable>): Promise<InsertResult> {
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
      method: 'POST',
      url: transformUrl({ url: this.params.url, pathname: '/', searchParams }),
      body: params.values,
      abort_signal: params.abort_signal,
      compress_request: this.params.compression.compress_request,
    })

    return { query_id }
  }

  async close(): Promise<void> {
    if (this.agent !== undefined && this.agent.destroy !== undefined) {
      this.agent.destroy()
    }
  }

  private logResponse(
    request: Http.ClientRequest,
    params: RequestParams,
    response: Http.IncomingMessage,
    startTimestamp: number
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { authorization, host, ...headers } = request.getHeaders()
    const duration = Date.now() - startTimestamp
    this.params.logWriter.debug({
      module: 'HTTP Adapter',
      message: 'Got a response from ClickHouse',
      args: {
        request_method: params.method,
        request_path: params.url.pathname,
        request_params: params.url.search,
        request_headers: headers,
        response_status: response.statusCode,
        response_headers: response.headers,
        response_time_ms: duration,
      },
    })
  }
}

function isEventTarget(signal: any): signal is EventTarget {
  return 'removeEventListener' in signal
}

function decompressResponse(response: Http.IncomingMessage):
  | {
      response: Stream.Readable
    }
  | { error: Error } {
  const encoding = response.headers['content-encoding']

  if (encoding === 'gzip') {
    return {
      response: Stream.pipeline(
        response,
        Zlib.createGunzip(),
        function pipelineCb(err) {
          if (err) {
            console.error(err)
          }
        }
      ),
    }
  } else if (encoding !== undefined) {
    return {
      error: new Error(`Unexpected encoding: ${encoding}`),
    }
  }

  return { response }
}

function isDecompressionError(result: any): result is { error: Error } {
  return result.error !== undefined
}
