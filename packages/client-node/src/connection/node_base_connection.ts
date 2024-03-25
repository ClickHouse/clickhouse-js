import type {
  ClickHouseSummary,
  ConnBaseQueryParams,
  Connection,
  ConnectionParams,
  ConnExecResult,
  ConnInsertParams,
  ConnInsertResult,
  ConnPingResult,
  ConnQueryResult,
  LogWriter,
} from '@clickhouse/client-common'
import {
  isSuccessfulResponse,
  parseError,
  toSearchParams,
  transformUrl,
  withHttpSettings,
} from '@clickhouse/client-common'
import crypto from 'crypto'
import type Http from 'http'
import type * as net from 'net'
import Stream from 'stream'
import Zlib from 'zlib'
import { getAsText, getUserAgent, isStream } from '../utils'

export type NodeConnectionParams = Omit<ConnectionParams, 'keep_alive'> & {
  tls?: TLSParams
  keep_alive: {
    enabled: boolean
    socket_ttl: number
    retry_on_expired_socket: boolean
  }
}

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
  parse_summary?: boolean
}

const expiredSocketMessage = 'expired socket'

interface RequestResult {
  stream: Stream.Readable
  summary?: ClickHouseSummary
}

export abstract class NodeBaseConnection
  implements Connection<Stream.Readable>
{
  protected readonly headers: Http.OutgoingHttpHeaders
  private readonly logger: LogWriter
  private readonly retry_expired_sockets: boolean
  private readonly known_sockets = new WeakMap<
    net.Socket,
    {
      id: string
      last_used_time: number
    }
  >()
  protected constructor(
    protected readonly params: NodeConnectionParams,
    protected readonly agent: Http.Agent,
  ) {
    this.logger = params.log_writer
    this.retry_expired_sockets =
      params.keep_alive.enabled && params.keep_alive.retry_on_expired_socket
    this.headers = this.buildDefaultHeaders(
      params.username,
      params.password,
      params.http_headers,
    )
  }

  protected buildDefaultHeaders(
    username: string,
    password: string,
    http_headers?: Record<string, string>,
  ): Http.OutgoingHttpHeaders {
    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        'base64',
      )}`,
      'User-Agent': getUserAgent(this.params.application_id),
      ...http_headers,
    }
  }

  protected abstract createClientRequest(
    params: RequestParams,
  ): Http.ClientRequest

  private async request(
    params: RequestParams,
    retryCount = 0,
  ): Promise<RequestResult> {
    try {
      return await this._request(params)
    } catch (e) {
      if (e instanceof Error && e.message === expiredSocketMessage) {
        if (this.retry_expired_sockets && retryCount < 3) {
          this.logger.trace({
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

  private async _request(params: RequestParams): Promise<RequestResult> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const request = this.createClientRequest(params)

      function onError(err: Error): void {
        removeRequestListeners()
        reject(err)
      }

      const onResponse = async (
        _response: Http.IncomingMessage,
      ): Promise<void> => {
        this.logResponse(request, params, _response, start)

        const decompressionResult = decompressResponse(_response)

        if (isDecompressionError(decompressionResult)) {
          return reject(decompressionResult.error)
        }

        if (isSuccessfulResponse(_response.statusCode)) {
          return resolve({
            stream: decompressionResult.response,
            summary: params.parse_summary
              ? this.parseSummary(_response)
              : undefined,
          })
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
        reject(new Error('The user aborted a request.'))
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
              this.params.keep_alive.socket_ttl
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
                id: socketInfo.id,
                last_used_time: Date.now(),
              })
              pipeStream()
            }
          } else {
            const socketId = crypto.randomUUID()
            this.logger.trace({
              module: 'Connection',
              message: `Using a new socket ${socketId}`,
            })
            this.known_sockets.set(socket, {
              id: socketId,
              last_used_time: Date.now(),
            })
            pipeStream()
          }
        } else {
          // no need to track the reused sockets;
          // keep alive is disabled or retry mechanism is not enabled
          pipeStream()
        }

        // this is for request timeout only.
        // The socket won't be actually destroyed,
        // and it will be returned to the pool.
        // TODO: investigate if can actually remove the idle sockets properly
        socket.setTimeout(this.params.request_timeout, onTimeout)
      }

      function onTimeout(): void {
        removeRequestListeners()
        request.destroy()
        reject(new Error('Timeout error.'))
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

  async ping(): Promise<ConnPingResult> {
    try {
      const { stream } = await this.request({
        method: 'GET',
        url: transformUrl({ url: this.params.url, pathname: '/ping' }),
      })
      stream.destroy()
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

  async query(
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<Stream.Readable>> {
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

    const { stream } = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.params.url, searchParams }),
      body: params.query,
      abort_signal: params.abort_signal,
      decompress_response: clickhouse_settings.enable_http_compression === 1,
    })

    return {
      stream,
      query_id,
    }
  }

  async exec(
    params: ConnBaseQueryParams,
  ): Promise<ConnExecResult<Stream.Readable>> {
    const query_id = getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })

    const { stream, summary } = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.params.url, searchParams }),
      body: params.query,
      abort_signal: params.abort_signal,
      parse_summary: true,
    })

    return {
      stream,
      query_id,
      summary,
    }
  }

  async insert(
    params: ConnInsertParams<Stream.Readable>,
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

    const { stream, summary } = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.params.url, searchParams }),
      body: params.values,
      abort_signal: params.abort_signal,
      compress_request: this.params.compression.compress_request,
      parse_summary: true,
    })

    await this.drainHttpResponse(stream)
    return { query_id, summary }
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
    startTimestamp: number,
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { authorization, host, ...headers } = request.getHeaders()
    const duration = Date.now() - startTimestamp
    this.params.log_writer.debug({
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

  private async drainHttpResponse(stream: Stream.Readable): Promise<void> {
    return new Promise((resolve, reject) => {
      function dropData() {
        // We don't care about the data
      }

      function onEnd() {
        removeListeners()
        resolve()
      }

      function onError(err: Error) {
        removeListeners()
        reject(err)
      }

      function onClose() {
        removeListeners()
      }

      function removeListeners() {
        stream.removeListener('data', dropData)
        stream.removeListener('end', onEnd)
        stream.removeListener('error', onError)
        stream.removeListener('onClose', onClose)
      }

      stream.on('data', dropData)
      stream.on('end', onEnd)
      stream.on('error', onError)
      stream.on('close', onClose)
    })
  }

  private parseSummary(
    response: Http.IncomingMessage,
  ): ClickHouseSummary | undefined {
    const summaryHeader = response.headers['x-clickhouse-summary']
    if (typeof summaryHeader === 'string') {
      try {
        return JSON.parse(summaryHeader)
      } catch (err) {
        this.logger.error({
          module: 'Connection',
          message: `Failed to parse X-ClickHouse-Summary header, got: ${summaryHeader}`,
          err: err as Error,
        })
      }
    }
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
            // FIXME: use logger instead
            // eslint-disable-next-line no-console
            console.error(err)
          }
        },
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

function getQueryId(query_id: string | undefined): string {
  return query_id || crypto.randomUUID()
}
