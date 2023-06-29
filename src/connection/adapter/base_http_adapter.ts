import Stream from 'stream'
import type Http from 'http'
import Zlib from 'zlib'
import { parseError } from '../../error'

import type { Logger } from '../../logger'

import type {
  BaseParams,
  Connection,
  ConnectionParams,
  ExecParams,
  ExecResult,
  InsertParams,
  InsertResult,
  QueryParams,
  QueryResult,
} from '../connection'
import { toSearchParams } from './http_search_params'
import { transformUrl } from './transform_url'
import { getAsText, isStream } from '../../utils'
import type { ClickHouseSettings } from '../../settings'
import { getUserAgent } from '../../utils/user_agent'
import * as uuid from 'uuid'
import type * as net from 'net'

export interface RequestParams {
  method: 'GET' | 'POST'
  url: URL
  body?: string | Stream.Readable
  abort_signal?: AbortSignal
  decompress_response?: boolean
  compress_request?: boolean
}

function isSuccessfulResponse(statusCode?: number): boolean {
  return Boolean(statusCode && 200 <= statusCode && statusCode < 300)
}

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

const expiredSocketMessage = 'expired socket'

export abstract class BaseHttpAdapter implements Connection {
  protected readonly headers: Http.OutgoingHttpHeaders
  private readonly retry_expired_sockets: boolean
  private readonly known_sockets = new WeakMap<
    net.Socket,
    {
      id: string
      last_used_time: number
    }
  >()
  protected constructor(
    protected readonly config: ConnectionParams,
    private readonly logger: Logger,
    protected readonly agent: Http.Agent
  ) {
    this.headers = this.buildDefaultHeaders(config.username, config.password)
    this.retry_expired_sockets =
      this.config.keep_alive.enabled &&
      this.config.keep_alive.retry_on_expired_socket
  }

  protected buildDefaultHeaders(
    username: string,
    password: string
  ): Http.OutgoingHttpHeaders {
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        'base64'
      )}`,
      'User-Agent': getUserAgent(this.config.application_id),
    }
  }

  protected abstract createClientRequest(
    params: RequestParams,
    abort_signal?: AbortSignal
  ): Http.ClientRequest

  private async request(
    params: RequestParams,
    retryCount = 0
  ): Promise<Stream.Readable> {
    try {
      return await this._request(params)
    } catch (e) {
      if (e instanceof Error && e.message === expiredSocketMessage) {
        if (this.retry_expired_sockets && retryCount < 3) {
          this.logger.debug({
            module: 'Connection',
            message: `Keep-Alive socket is expired, retrying with a new one, retries so far: ${retryCount}`,
          })
          return await this.request(params, retryCount + 1)
        } else {
          throw new Error(`Socket hang up after ${retryCount} retries`)
        }
      }
      throw e
    }
  }

  private async _request(params: RequestParams): Promise<Stream.Readable> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const request = this.createClientRequest(params, params.abort_signal)

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

      function pipeStream(): void {
        // if request.end() was called due to no data to send
        if (request.writableEnded) {
          return
        }

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
      }

      const onSocket = (socket: net.Socket) => {
        if (this.retry_expired_sockets) {
          // if socket is reused
          const socketInfo = this.known_sockets.get(socket)
          if (socketInfo !== undefined) {
            this.logger.trace({
              module: 'Connection',
              message: `Reused socket ${socketInfo.id}`,
            })
            // if a socket was reused at an unfortunate time,
            // and is likely about to expire
            const isPossiblyExpired =
              Date.now() - socketInfo.last_used_time >
              this.config.keep_alive.socket_ttl
            if (isPossiblyExpired) {
              this.logger.trace({
                module: 'Connection',
                message: 'Socket should be expired - terminate it',
              })
              this.known_sockets.delete(socket)
              socket.destroy() // immediately terminate the connection
              request.destroy()
              reject(new Error(expiredSocketMessage))
            } else {
              this.logger.trace({
                module: 'Connection',
                message: `Socket ${socketInfo.id} is safe to be reused`,
              })
              this.known_sockets.set(socket, {
                ...socketInfo,
                last_used_time: Date.now(),
              })
              pipeStream()
            }
          } else {
            const socketId = uuid.v4()
            this.logger.trace({
              module: 'Connection',
              message: `Using a new socket ${socketId}`,
            })
            Object.assign(socket, { id: socketId })
            this.known_sockets.set(socket, {
              id: socketId,
              last_used_time: Date.now(),
            })
            pipeStream()
          }
        } else {
          // keep alive is disabled or retry mechanism is not enabled;
          // no need to track the reused sockets
          pipeStream()
        }

        // this is for request timeout only.
        // The socket won't be actually destroyed,
        // and it will be returned to the pool.
        // TODO: investigate if can actually remove the idle sockets properly
        socket.setTimeout(this.config.request_timeout, onTimeout)
      }

      function onTimeout(): void {
        removeRequestListeners()
        request.destroy()
        reject(new Error('Timeout error'))
      }

      function removeRequestListeners(): void {
        if (request.socket !== null) {
          request.socket.setTimeout(0) // reset previously set timeout
          request.socket.removeListener('timeout', onTimeout)
        }
        request.removeListener('socket', onSocket)
        request.removeListener('response', onResponse)
        request.removeListener('error', onError)
        request.removeListener('close', onClose)
        if (params.abort_signal !== undefined) {
          request.removeListener('abort', onAbort)
        }
      }

      request.on('socket', onSocket)
      request.on('response', onResponse)
      request.on('error', onError)
      request.on('close', onClose)

      if (params.abort_signal !== undefined) {
        params.abort_signal.addEventListener('abort', onAbort, { once: true })
      }

      if (!params.body) return request.end()
    })
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

  async query(params: QueryParams): Promise<QueryResult> {
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

  async exec(params: ExecParams): Promise<ExecResult> {
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

    const stream = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.config.url, pathname: '/', searchParams }),
      body: params.values,
      abort_signal: params.abort_signal,
      compress_request: this.config.compression.compress_request,
    })

    stream.destroy()
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
    request: Http.ClientRequest,
    params: RequestParams,
    response: Http.IncomingMessage,
    startTimestamp: number
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { authorization, host, ...headers } = request.getHeaders()
    const duration = Date.now() - startTimestamp
    this.logger.debug({
      module: 'Connection',
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

  protected getHeaders(params: RequestParams) {
    return {
      ...this.headers,
      ...(params.decompress_response ? { 'Accept-Encoding': 'gzip' } : {}),
      ...(params.compress_request ? { 'Content-Encoding': 'gzip' } : {}),
    }
  }
}
