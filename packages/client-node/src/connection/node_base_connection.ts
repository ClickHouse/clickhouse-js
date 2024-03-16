import type {
  ClickHouseSummary,
  ConnBaseQueryParams,
  Connection,
  ConnectionParams,
  ConnExecResult,
  ConnInsertParams,
  ConnInsertResult,
  ConnOperation,
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
import type { URLSearchParams } from 'url'
import Zlib from 'zlib'
import { getAsText, getUserAgent, isStream } from '../utils'
import { decompressResponse, isDecompressionError } from './compression'
import { drainStream } from './stream'

export type NodeConnectionParams = ConnectionParams & {
  tls?: TLSParams
  keep_alive: {
    enabled: boolean
    idle_socket_ttl: number
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
  // provided by the user and wrapped around internally
  abort_signal: AbortSignal
  decompress_response?: boolean
  compress_request?: boolean
  parse_summary?: boolean
}

export abstract class NodeBaseConnection
  implements Connection<Stream.Readable>
{
  protected readonly headers: Http.OutgoingHttpHeaders
  private readonly logger: LogWriter
  private readonly knownSockets = new WeakMap<net.Socket, SocketInfo>()
  private readonly idleSocketTTL: number

  protected constructor(
    protected readonly params: NodeConnectionParams,
    protected readonly agent: Http.Agent
  ) {
    this.logger = params.log_writer
    this.idleSocketTTL = params.keep_alive.idle_socket_ttl
    this.headers = this.buildDefaultHeaders(
      params.username,
      params.password,
      params.http_headers
    )
  }

  protected buildDefaultHeaders(
    username: string,
    password: string,
    additional_http_headers?: Record<string, string>
  ): Http.OutgoingHttpHeaders {
    return {
      // KeepAlive agent for some reason does not set this on its own
      Connection: this.params.keep_alive.enabled ? 'keep-alive' : 'close',
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString(
        'base64'
      )}`,
      'User-Agent': getUserAgent(this.params.application_id),
      ...additional_http_headers,
    }
  }

  protected abstract createClientRequest(
    params: RequestParams
  ): Http.ClientRequest

  private async request(
    params: RequestParams,
    op: ConnOperation
  ): Promise<RequestResult> {
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const request = this.createClientRequest(params)

      function onError(err: Error): void {
        removeRequestListeners()
        reject(err)
      }

      const onResponse = async (
        _response: Http.IncomingMessage
      ): Promise<void> => {
        this.logResponse(op, request, params, _response, start)

        const decompressionResult = decompressResponse(_response)
        if (isDecompressionError(decompressionResult)) {
          return reject(decompressionResult.error)
        }
        if (isSuccessfulResponse(_response.statusCode)) {
          return resolve({
            stream: decompressionResult.response,
            summary: params.parse_summary
              ? this.parseSummary(op, _response)
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
        if (this.params.keep_alive.enabled) {
          const socketInfo = this.knownSockets.get(socket)
          // It is the first time we encounter this socket,
          // so it doesn't have the idle timeout handler attached to it
          if (socketInfo === undefined) {
            const socketId = crypto.randomUUID()
            this.logger.trace({
              message: `Using a fresh socket ${socketId}, setting up a new 'free' listener`,
            })
            this.knownSockets.set(socket, {
              id: socketId,
              idle_timeout_handle: undefined,
            })
            // When the request is complete and the socket is released,
            // make sure that the socket is removed after `idleSocketTTL`.
            socket.on('free', () => {
              this.logger.trace({
                message: `Socket ${socketId} was released`,
              })
              // Avoiding the built-in socket.timeout() method usage here,
              // as we don't want to clash with the actual request timeout.
              const idleTimeoutHandle = setTimeout(() => {
                this.logger.trace({
                  message: `Removing socket ${socketId} after ${this.idleSocketTTL} ms of idle`,
                })
                this.knownSockets.delete(socket)
                socket.destroy()
              }, this.idleSocketTTL).unref()
              this.knownSockets.set(socket, {
                id: socketId,
                idle_timeout_handle: idleTimeoutHandle,
              })
            })

            const cleanup = () => {
              const maybeSocketInfo = this.knownSockets.get(socket)
              // clean up a possibly dangling idle timeout handle (preventing leaks)
              if (maybeSocketInfo?.idle_timeout_handle) {
                clearTimeout(maybeSocketInfo.idle_timeout_handle)
              }
              this.logger.trace({
                message: `Socket ${socketId} was closed or ended, 'free' listener removed`,
              })
            }
            socket.once('end', cleanup)
            socket.once('close', cleanup)
          } else {
            clearTimeout(socketInfo.idle_timeout_handle)
            this.logger.trace({
              message: `Reusing socket ${socketInfo.id}`,
            })
            this.knownSockets.set(socket, {
              ...socketInfo,
              idle_timeout_handle: undefined,
            })
          }
        }

        // Socket is "prepared" with idle handlers, continue with our request
        pipeStream()

        // This is for request timeout only. Surprisingly, it is not always enough to set in the HTTP request.
        // The socket won't be actually destroyed, and it will be returned to the pool.
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
    const abortController = new AbortController()
    try {
      const { stream } = await this.request(
        {
          method: 'GET',
          url: transformUrl({ url: this.params.url, pathname: '/ping' }),
          abort_signal: abortController.signal,
        },
        'Ping'
      )
      await drainStream(stream)
      return { success: true }
    } catch (error) {
      // it is used to ensure that the outgoing request is terminated,
      // and we don't get an unhandled error propagation later
      abortController.abort('Ping failed')
      // not an error, as this might be semi-expected
      this.logger.warn({
        message: this.httpRequestErrorMessage('Ping'),
        err: error as Error,
      })
      return {
        success: false,
        error: error as Error, // should NOT be propagated to the user
      }
    }
  }

  async query(
    params: ConnBaseQueryParams
  ): Promise<ConnQueryResult<Stream.Readable>> {
    const query_id = this.getQueryId(params.query_id)
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
    const decompressResponse = clickhouse_settings.enable_http_compression === 1
    const { controller, controllerCleanup } = this.getAbortController(params)
    try {
      const { stream } = await this.request(
        {
          method: 'POST',
          url: transformUrl({ url: this.params.url, searchParams }),
          body: params.query,
          abort_signal: controller.signal,
          decompress_response: decompressResponse,
        },
        'Query'
      )
      return {
        stream,
        query_id,
      }
    } catch (err) {
      controller.abort('Query HTTP request failed')
      this.logRequestError({
        op: 'Query',
        query_id: query_id,
        query_params: params,
        search_params: searchParams,
        err: err as Error,
        extra_args: {
          decompress_response: decompressResponse,
          clickhouse_settings,
        },
      })
      throw err // should be propagated to the user
    } finally {
      controllerCleanup()
    }
  }

  async exec(
    params: ConnBaseQueryParams
  ): Promise<ConnExecResult<Stream.Readable>> {
    const query_id = this.getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      session_id: params.session_id,
      query_id,
    })
    const { controller, controllerCleanup } = this.getAbortController(params)
    try {
      const { stream, summary } = await this.request(
        {
          method: 'POST',
          url: transformUrl({ url: this.params.url, searchParams }),
          body: params.query,
          abort_signal: controller.signal,
          parse_summary: true,
        },
        'Exec'
      )
      return {
        stream,
        query_id,
        summary,
      }
    } catch (err) {
      controller.abort('Exec HTTP request failed')
      this.logRequestError({
        op: 'Exec',
        query_id: query_id,
        query_params: params,
        search_params: searchParams,
        err: err as Error,
        extra_args: {
          clickhouse_settings: params.clickhouse_settings ?? {},
        },
      })
      throw err // should be propagated to the user
    } finally {
      controllerCleanup()
    }
  }

  async insert(
    params: ConnInsertParams<Stream.Readable>
  ): Promise<ConnInsertResult> {
    const query_id = this.getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      query: params.query,
      session_id: params.session_id,
      query_id,
    })
    const { controller, controllerCleanup } = this.getAbortController(params)
    try {
      const { stream, summary } = await this.request(
        {
          method: 'POST',
          url: transformUrl({ url: this.params.url, searchParams }),
          body: params.values,
          abort_signal: controller.signal,
          compress_request: this.params.compression.compress_request,
          parse_summary: true,
        },
        'Insert'
      )
      await drainStream(stream)
      return { query_id, summary }
    } catch (err) {
      controller.abort('Insert HTTP request failed')
      this.logRequestError({
        op: 'Insert',
        query_id: query_id,
        query_params: params,
        search_params: searchParams,
        err: err as Error,
        extra_args: {
          clickhouse_settings: params.clickhouse_settings ?? {},
        },
      })
      throw err // should be propagated to the user
    } finally {
      controllerCleanup()
    }
  }

  async close(): Promise<void> {
    if (this.agent !== undefined && this.agent.destroy !== undefined) {
      this.agent.destroy()
    }
  }

  private getQueryId(query_id: string | undefined): string {
    return query_id || crypto.randomUUID()
  }

  // a wrapper over the user's Signal to terminate the failed requests
  private getAbortController(params: ConnBaseQueryParams): {
    controller: AbortController
    controllerCleanup: () => void
  } {
    const controller = new AbortController()
    function onAbort() {
      controller.abort()
    }
    params.abort_signal?.addEventListener('abort', onAbort)
    return {
      controller,
      controllerCleanup: () => {
        params.abort_signal?.removeEventListener('abort', onAbort)
      },
    }
  }

  private logResponse(
    op: ConnOperation,
    request: Http.ClientRequest,
    params: RequestParams,
    response: Http.IncomingMessage,
    startTimestamp: number
  ) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { authorization, host, ...headers } = request.getHeaders()
    const duration = Date.now() - startTimestamp
    this.params.log_writer.debug({
      module: 'HTTP Adapter',
      message: `${op}: got a response from ClickHouse`,
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

  private logRequestError({
    op,
    err,
    query_id,
    query_params,
    search_params,
    extra_args,
  }: LogRequestErrorParams) {
    this.logger.error({
      message: this.httpRequestErrorMessage(op),
      err: err as Error,
      args: {
        query: query_params.query,
        search_params: search_params?.toString() ?? '',
        with_abort_signal: query_params.abort_signal !== undefined,
        session_id: query_params.session_id,
        query_id: query_id,
        ...extra_args,
      },
    })
  }

  private httpRequestErrorMessage(op: ConnOperation): string {
    return `${op}: HTTP request error.`
  }

  private parseSummary(
    op: ConnOperation,
    response: Http.IncomingMessage
  ): ClickHouseSummary | undefined {
    const summaryHeader = response.headers['x-clickhouse-summary']
    if (typeof summaryHeader === 'string') {
      try {
        return JSON.parse(summaryHeader)
      } catch (err) {
        this.logger.error({
          message: `${op}: failed to parse X-ClickHouse-Summary header.`,
          args: {
            'X-ClickHouse-Summary': summaryHeader,
          },
          err: err as Error,
        })
      }
    }
  }
}

interface RequestResult {
  stream: Stream.Readable
  summary?: ClickHouseSummary
}

interface LogRequestErrorParams {
  op: ConnOperation
  err: Error
  query_id: string
  query_params: ConnBaseQueryParams
  search_params: URLSearchParams | undefined
  extra_args: Record<string, unknown>
}

interface SocketInfo {
  id: string
  idle_timeout_handle: ReturnType<typeof setTimeout> | undefined
}
