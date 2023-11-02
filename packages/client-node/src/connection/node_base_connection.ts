import type {
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
  op: 'INSERT' | 'QUERY' | 'PING' | 'EXEC'
  method: 'GET' | 'POST'
  url: URL
  body?: string | Stream.Readable
  abort_signal?: AbortSignal
  decompress_response?: boolean
  compress_request?: boolean
}

interface SocketInfo {
  id: string
  idle_timeout_handle: ReturnType<typeof setTimeout> | undefined
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
    this.headers = this.buildDefaultHeaders(params.username, params.password)
    this.idleSocketTTL = params.keep_alive.idle_socket_ttl
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
    params: RequestParams
  ): Http.ClientRequest

  private async request(params: RequestParams): Promise<Stream.Readable> {
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

            socket.on('end', () => {
              this.logger.trace({
                message: `Socket ${socketId} was ended elsewhere, removing our 'free' listener`,
              })
              const maybeSocketInfo = this.knownSockets.get(socket)
              // clean up a possibly dangling idle timeout handle (preventing leaks)
              if (maybeSocketInfo?.idle_timeout_handle) {
                clearTimeout(maybeSocketInfo.idle_timeout_handle)
              }
            })
          } else {
            this.logger.trace({
              message: `Reusing socket ${socketInfo.id}`,
            })
            clearTimeout(socketInfo.idle_timeout_handle)
            this.knownSockets.set(socket, {
              ...socketInfo,
              idle_timeout_handle: undefined,
            })
          }
        }

        // This is the actual request timeout.
        // The socket won't be actually destroyed,
        // and it will be returned to the pool.
        socket.setTimeout(this.params.request_timeout, onTimeout)

        // Socket is "prepared" with idle handlers, continue with our request
        pipeStream()
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
      const stream = await this.request({
        method: 'GET',
        url: transformUrl({ url: this.params.url, pathname: '/ping' }),
        op: 'PING',
      })
      await this.drainHttpResponse(stream)
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
    params: ConnBaseQueryParams
  ): Promise<ConnQueryResult<Stream.Readable>> {
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
      op: 'QUERY',
    })

    return {
      stream,
      query_id,
    }
  }

  async exec(
    params: ConnBaseQueryParams
  ): Promise<ConnExecResult<Stream.Readable>> {
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
      op: 'EXEC',
    })

    return {
      stream,
      query_id,
    }
  }

  async insert(
    params: ConnInsertParams<Stream.Readable>
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

    const stream = await this.request({
      method: 'POST',
      url: transformUrl({ url: this.params.url, pathname: '/', searchParams }),
      body: params.values,
      abort_signal: params.abort_signal,
      compress_request: this.params.compression.compress_request,
      op: 'INSERT',
    })

    await this.drainHttpResponse(stream)
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
    if (this.params.log_response) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { authorization, host, ...headers } = request.getHeaders()
      const duration = Date.now() - startTimestamp
      this.params.log_writer.debug({
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

function getQueryId(query_id: string | undefined): string {
  return query_id || crypto.randomUUID()
}
