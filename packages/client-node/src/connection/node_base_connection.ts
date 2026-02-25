import type {
  ClickHouseSummary,
  ConnBaseQueryParams,
  ConnCommandResult,
  Connection,
  ConnectionParams,
  ConnExecParams,
  ConnExecResult,
  ConnInsertParams,
  ConnInsertResult,
  ConnOperation,
  ConnPingResult,
  ConnQueryResult,
  JSONHandling,
  LogWriter,
  ResponseHeaders,
} from '@clickhouse/client-common'
import {
  enhanceStackTrace,
  getCurrentStackTrace,
  isCredentialsAuth,
  isJWTAuth,
  isSuccessfulResponse,
  parseError,
  sleep,
  toSearchParams,
  transformUrl,
  withHttpSettings,
  ClickHouseLogLevel,
} from '@clickhouse/client-common'
import { type ConnPingParams } from '@clickhouse/client-common'
import crypto from 'crypto'
import type Http from 'http'
import type * as net from 'net'
import type Https from 'node:https'
import Stream from 'stream'
import Zlib from 'zlib'
import { getAsText, getUserAgent, isStream } from '../utils'
import { decompressResponse, isDecompressionError } from './compression'
import { drainStream } from './stream'

export type NodeConnectionParams = ConnectionParams & {
  tls?: TLSParams
  http_agent?: Http.Agent | Https.Agent
  set_basic_auth_header: boolean
  capture_enhanced_stack_trace: boolean
  keep_alive: {
    enabled: boolean
    idle_socket_ttl: number
  }
  log_level: ClickHouseLogLevel
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
  headers: Http.OutgoingHttpHeaders
  body?: string | Stream.Readable
  // provided by the user and wrapped around internally
  abort_signal: AbortSignal
  enable_response_compression?: boolean
  enable_request_compression?: boolean
  // if there are compression headers, attempt to decompress it
  try_decompress_response_stream?: boolean
  // if the response contains an error, ignore it and return the stream as-is
  ignore_error_response?: boolean
  parse_summary?: boolean
  query: string
  query_id: string
  log_writer: LogWriter
  log_level: ClickHouseLogLevel
}

export abstract class NodeBaseConnection implements Connection<Stream.Readable> {
  protected readonly defaultAuthHeader: string
  protected readonly defaultHeaders: Http.OutgoingHttpHeaders

  private readonly jsonHandling: JSONHandling
  private readonly knownSockets = new WeakMap<net.Socket, SocketInfo>()
  private readonly idleSocketTTL: number
  private readonly connectionId: string = crypto.randomUUID()
  private socketCounter = 0
  // For overflow concerns:
  //   node -e 'console.log(Number.MAX_SAFE_INTEGER / (1_000_000 * 60 * 60 * 24 * 366))'
  // gives 284 years of continuous operation at 1M requests per second
  // before overflowing the 53-bit integer
  private requestCounter = 0

  private getNewSocketId(): string {
    this.socketCounter += 1
    return `${this.connectionId}:${this.socketCounter}`
  }

  private getNewRequestId(): string {
    this.requestCounter += 1
    return `${this.connectionId}:${this.requestCounter}`
  }

  protected constructor(
    protected readonly params: NodeConnectionParams,
    protected readonly agent: Http.Agent,
  ) {
    if (params.auth.type === 'Credentials') {
      this.defaultAuthHeader = `Basic ${Buffer.from(
        `${params.auth.username}:${params.auth.password}`,
      ).toString('base64')}`
    } else if (params.auth.type === 'JWT') {
      this.defaultAuthHeader = `Bearer ${params.auth.access_token}`
    } else {
      throw new Error(`Unknown auth type: ${(params.auth as any).type}`)
    }
    this.defaultHeaders = {
      // Node.js HTTP agent, for some reason, does not set this on its own when KeepAlive is enabled
      Connection: this.params.keep_alive.enabled ? 'keep-alive' : 'close',
      'User-Agent': getUserAgent(this.params.application_id),
    }
    this.idleSocketTTL = params.keep_alive.idle_socket_ttl
    this.jsonHandling = params.json ?? {
      parse: JSON.parse,
      stringify: JSON.stringify,
    }
  }

  async ping(params: ConnPingParams): Promise<ConnPingResult> {
    const { log_writer, log_level } = this.params
    const query_id = this.getQueryId(params.query_id)
    const { controller, controllerCleanup } = this.getAbortController(params)
    let result: RequestResult
    try {
      if (params.select) {
        const searchParams = toSearchParams({
          database: undefined,
          query: PingQuery,
          query_id,
        })
        result = await this.request(
          {
            method: 'GET',
            url: transformUrl({ url: this.params.url, searchParams }),
            query: PingQuery,
            abort_signal: controller.signal,
            headers: this.buildRequestHeaders(),
            query_id,
            log_writer,
            log_level,
          },
          'Ping',
        )
      } else {
        result = await this.request(
          {
            method: 'GET',
            url: transformUrl({ url: this.params.url, pathname: '/ping' }),
            abort_signal: controller.signal,
            headers: this.buildRequestHeaders(),
            query: 'ping',
            query_id,
            log_writer,
            log_level,
          },
          'Ping',
        )
      }
      await drainStream(
        {
          op: 'Ping' as const,
          log_writer,
          query_id,
          log_level,
        },
        result.stream,
      )
      return { success: true }
    } catch (error) {
      // it is used to ensure that the outgoing request is terminated,
      // and we don't get unhandled error propagation later
      controller.abort('Ping failed')
      // not an error, as this might be semi-expected
      if (log_level <= ClickHouseLogLevel.WARN) {
        log_writer.warn({
          message: this.httpRequestErrorMessage('Ping'),
          err: error as Error,
          args: {
            connection_id: this.connectionId,
            query_id,
          },
        })
      }
      return {
        success: false,
        error: error as Error, // should NOT be propagated to the user
      }
    } finally {
      controllerCleanup()
    }
  }

  async query(
    params: ConnBaseQueryParams,
  ): Promise<ConnQueryResult<Stream.Readable>> {
    const { log_writer, log_level } = this.params
    const query_id = this.getQueryId(params.query_id)
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.params.compression.decompress_response,
    )
    const searchParams = toSearchParams({
      database: this.params.database,
      query_params: params.query_params,
      session_id: params.session_id,
      clickhouse_settings,
      query_id,
      role: params.role,
    })
    const { controller, controllerCleanup } = this.getAbortController(params)
    // allows enforcing the compression via the settings even if the client instance has it disabled
    const enableResponseCompression =
      clickhouse_settings.enable_http_compression === 1
    try {
      const { response_headers, stream, http_status_code } = await this.request(
        {
          method: 'POST',
          url: transformUrl({ url: this.params.url, searchParams }),
          body: params.query,
          abort_signal: controller.signal,
          enable_response_compression: enableResponseCompression,
          headers: this.buildRequestHeaders(params),
          query: params.query,
          query_id,
          log_writer,
          log_level,
        },
        'Query',
      )
      return {
        stream,
        response_headers,
        query_id,
        http_status_code,
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
          decompress_response: enableResponseCompression,
          clickhouse_settings,
        },
      })
      throw err // should be propagated to the user
    } finally {
      controllerCleanup()
    }
  }

  async insert(
    params: ConnInsertParams<Stream.Readable>,
  ): Promise<ConnInsertResult> {
    const { log_writer, log_level } = this.params
    const query_id = this.getQueryId(params.query_id)
    const searchParams = toSearchParams({
      database: this.params.database,
      clickhouse_settings: params.clickhouse_settings,
      query_params: params.query_params,
      query: params.query,
      session_id: params.session_id,
      role: params.role,
      query_id,
    })
    const { controller, controllerCleanup } = this.getAbortController(params)
    try {
      const { stream, summary, response_headers, http_status_code } =
        await this.request(
          {
            method: 'POST',
            url: transformUrl({ url: this.params.url, searchParams }),
            body: params.values,
            abort_signal: controller.signal,
            enable_request_compression:
              this.params.compression.compress_request,
            parse_summary: true,
            headers: this.buildRequestHeaders(params),
            query: params.query,
            query_id,
            log_writer,
            log_level,
          },
          'Insert',
        )
      await drainStream(
        {
          op: 'Insert',
          log_writer,
          query_id,
          log_level,
        },
        stream,
      )
      return { query_id, summary, response_headers, http_status_code }
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

  async exec(
    params: ConnExecParams<Stream.Readable>,
  ): Promise<ConnExecResult<Stream.Readable>> {
    const query_id = this.getQueryId(params.query_id)
    return this.runExec({
      ...params,
      query_id,
      op: 'Exec',
    })
  }

  async command(params: ConnBaseQueryParams): Promise<ConnCommandResult> {
    const { log_writer, log_level } = this.params
    const query_id = this.getQueryId(params.query_id)
    const commandStartTime = Date.now()
    if (log_level <= ClickHouseLogLevel.TRACE) {
      log_writer.trace({
        message: 'Command: operation started',
        args: {
          operation: 'Command',
          connection_id: this.connectionId,
          query_id,
          query: this.params.unsafeLogUnredactedQueries
            ? params.query
            : undefined,
        },
      })
    }

    const { stream, summary, response_headers } = await this.runExec({
      ...params,
      query_id,
      op: 'Command',
    })

    const runExecDuration = Date.now() - commandStartTime
    if (log_level <= ClickHouseLogLevel.TRACE) {
      log_writer.trace({
        message: 'Command: runExec completed, starting stream drain',
        args: {
          operation: 'Command',
          connection_id: this.connectionId,
          query_id,
          runExec_duration_ms: runExecDuration,
          stream_state: {
            readable: stream.readable,
            readableEnded: stream.readableEnded,
            readableLength: stream.readableLength,
          },
        },
      })
    }

    // ignore the response stream and release the socket immediately
    const drainStartTime = Date.now()
    await drainStream(
      {
        op: 'Command',
        log_writer,
        query_id,
        log_level,
      },
      stream,
    )

    if (log_level <= ClickHouseLogLevel.TRACE) {
      const drainDuration = Date.now() - drainStartTime
      const totalDuration = Date.now() - commandStartTime

      log_writer.trace({
        message: 'Command: operation completed',
        args: {
          operation: 'Command',
          connection_id: this.connectionId,
          query_id,
          drain_duration_ms: drainDuration,
          total_duration_ms: totalDuration,
        },
      })
    }

    return { query_id, summary, response_headers }
  }

  async close(): Promise<void> {
    if (this.agent !== undefined && this.agent.destroy !== undefined) {
      this.agent.destroy()
    }
  }

  protected defaultHeadersWithOverride(
    params?: ConnBaseQueryParams,
  ): Http.OutgoingHttpHeaders {
    return {
      // Custom HTTP headers from the client configuration
      ...(this.params.http_headers ?? {}),
      // Custom HTTP headers for this particular request; it will override the client configuration with the same keys
      ...(params?.http_headers ?? {}),
      // Includes the `Connection` + `User-Agent` headers which we do not allow to override
      // An appropriate `Authorization` header might be added later
      // It is not always required - see the TLS headers in `node_https_connection.ts`
      ...this.defaultHeaders,
    }
  }

  protected buildRequestHeaders(
    params?: ConnBaseQueryParams,
  ): Http.OutgoingHttpHeaders {
    const headers = this.defaultHeadersWithOverride(params)
    if (isJWTAuth(params?.auth)) {
      return {
        ...headers,
        Authorization: `Bearer ${params.auth.access_token}`,
      }
    }
    if (this.params.set_basic_auth_header) {
      if (isCredentialsAuth(params?.auth)) {
        return {
          ...headers,
          Authorization: `Basic ${Buffer.from(`${params.auth.username}:${params.auth.password}`).toString('base64')}`,
        }
      } else {
        return {
          ...headers,
          Authorization: this.defaultAuthHeader,
        }
      }
    }
    return {
      ...headers,
    }
  }

  protected abstract createClientRequest(
    params: RequestParams,
  ): Http.ClientRequest

  private getQueryId(query_id: string | undefined): string {
    return query_id || crypto.randomUUID()
  }

  // a wrapper over the user's Signal to terminate the failed requests
  private getAbortController(params: { abort_signal?: AbortSignal }): {
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

  private logRequestError({
    op,
    err,
    query_id,
    query_params,
    search_params,
    extra_args,
  }: LogRequestErrorParams) {
    if (this.params.log_level <= ClickHouseLogLevel.ERROR) {
      // Redact query parameter from search params unless explicitly allowed
      if (!this.params.unsafeLogUnredactedQueries && search_params) {
        // Clone to avoid mutating the original search params
        search_params = new URLSearchParams(search_params)
        search_params.delete('query')
      }

      this.params.log_writer.error({
        message: this.httpRequestErrorMessage(op),
        err: err as Error,
        args: {
          operation: op,
          connection_id: this.connectionId,
          query_id,
          query: this.params.unsafeLogUnredactedQueries
            ? query_params.query
            : undefined,
          search_params: search_params?.toString(),
          with_abort_signal: query_params.abort_signal !== undefined,
          session_id: query_params.session_id,
          ...extra_args,
        },
      })
    }
  }

  private httpRequestErrorMessage(op: ConnOperation): string {
    return `${op}: HTTP request error.`
  }

  private parseSummary(
    op: ConnOperation,
    response: Http.IncomingMessage,
  ): ClickHouseSummary | undefined {
    const summaryHeader = response.headers['x-clickhouse-summary']
    if (typeof summaryHeader === 'string') {
      try {
        return this.jsonHandling.parse(summaryHeader)
      } catch (err) {
        if (this.params.log_level <= ClickHouseLogLevel.ERROR) {
          this.params.log_writer.error({
            message: `${op}: failed to parse X-ClickHouse-Summary header.`,
            args: {
              operation: op,
              connection_id: this.connectionId,
              'X-ClickHouse-Summary': summaryHeader,
            },
            err: err as Error,
          })
        }
      }
    }
  }

  private async runExec(
    params: RunExecParams,
  ): Promise<ConnExecResult<Stream.Readable>> {
    const { log_writer, log_level } = this.params
    const query_id = params.query_id
    const sendQueryInParams = params.values !== undefined
    const clickhouse_settings = withHttpSettings(
      params.clickhouse_settings,
      this.params.compression.decompress_response,
    )
    const toSearchParamsOptions = {
      query: sendQueryInParams ? params.query : undefined,
      database: this.params.database,
      query_params: params.query_params,
      session_id: params.session_id,
      role: params.role,
      clickhouse_settings,
      query_id,
    }
    const searchParams = toSearchParams(toSearchParamsOptions)
    const { controller, controllerCleanup } = this.getAbortController(params)
    const tryDecompressResponseStream =
      params.op === 'Exec'
        ? // allows disabling stream decompression for the `Exec` operation only
          (params.decompress_response_stream ??
          this.params.compression.decompress_response)
        : // there is nothing useful in the response stream for the `Command` operation,
          // and it is immediately destroyed; never decompress it
          false
    const ignoreErrorResponse = params.ignore_error_response ?? false
    try {
      const { stream, summary, response_headers, http_status_code } =
        await this.request(
          {
            method: 'POST',
            url: transformUrl({ url: this.params.url, searchParams }),
            body: sendQueryInParams ? params.values : params.query,
            abort_signal: controller.signal,
            parse_summary: true,
            enable_request_compression:
              this.params.compression.compress_request,
            enable_response_compression:
              this.params.compression.decompress_response,
            try_decompress_response_stream: tryDecompressResponseStream,
            ignore_error_response: ignoreErrorResponse,
            headers: this.buildRequestHeaders(params),
            query: params.query,
            query_id,
            log_writer,
            log_level,
          },
          params.op,
        )
      return {
        stream,
        query_id,
        summary,
        response_headers,
        http_status_code,
      }
    } catch (err) {
      controller.abort(`${params.op} HTTP request failed`)
      this.logRequestError({
        op: params.op,
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

  private async request(
    params: RequestParams,
    op: ConnOperation,
  ): Promise<RequestResult> {
    // allows the event loop to process the idle socket timers, if the CPU load is high
    // otherwise, we can occasionally get an expired socket, see https://github.com/ClickHouse/clickhouse-js/issues/294
    await sleep(0)
    const { log_writer, query_id, log_level } = params
    const currentStackTrace = this.params.capture_enhanced_stack_trace
      ? getCurrentStackTrace()
      : undefined
    const requestTimeout = this.params.request_timeout
    return new Promise((resolve, reject) => {
      const start = Date.now()
      const request = this.createClientRequest(params)
      const request_id = this.getNewRequestId()

      function onError(e: Error): void {
        removeRequestListeners()
        const err = enhanceStackTrace(e, currentStackTrace)
        reject(err)
      }

      let responseStream: Stream.Readable
      const onResponse = async (
        _response: Http.IncomingMessage,
      ): Promise<void> => {
        if (this.params.log_level <= ClickHouseLogLevel.DEBUG) {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { authorization, host, ...headers } = request.getHeaders()
          const duration = Date.now() - start

          // Redact query parameter from URL search params unless explicitly allowed
          let searchParams = params.url.searchParams
          if (!this.params.unsafeLogUnredactedQueries) {
            // Clone to avoid mutating the original search params
            searchParams = new URLSearchParams(searchParams)
            searchParams.delete('query')
          }

          this.params.log_writer.debug({
            module: 'HTTP Adapter',
            message: `${op}: got a response from ClickHouse`,
            args: {
              operation: op,
              connection_id: this.connectionId,
              query_id,
              request_id,
              request_method: params.method,
              request_path: params.url.pathname,
              request_params: searchParams.toString(),
              request_headers: headers,
              response_status: _response.statusCode,
              response_headers: _response.headers,
              response_time_ms: duration,
            },
          })
        }

        const tryDecompressResponseStream =
          params.try_decompress_response_stream ?? true
        const ignoreErrorResponse = params.ignore_error_response ?? false
        // even if the stream decompression is disabled, we have to decompress it in case of an error
        const isFailedResponse = !isSuccessfulResponse(_response.statusCode)
        if (
          tryDecompressResponseStream ||
          (isFailedResponse && !ignoreErrorResponse)
        ) {
          const decompressionResult = decompressResponse(
            _response,
            log_writer,
            log_level,
          )
          if (isDecompressionError(decompressionResult)) {
            const err = enhanceStackTrace(
              decompressionResult.error,
              currentStackTrace,
            )
            return reject(err)
          }
          responseStream = decompressionResult.response
        } else {
          responseStream = _response
        }

        if (log_level <= ClickHouseLogLevel.TRACE) {
          log_writer.trace({
            message: `${op}: response stream created`,
            args: {
              operation: op,
              connection_id: this.connectionId,
              query_id,
              request_id,
              stream_state: {
                readable: responseStream.readable,
                readableEnded: responseStream.readableEnded,
                readableLength: responseStream.readableLength,
              },
              is_failed_response: isFailedResponse,
              will_decompress: tryDecompressResponseStream,
            },
          })
        }

        if (isFailedResponse && !ignoreErrorResponse) {
          try {
            const errorMessage = await getAsText(responseStream)
            const err = enhanceStackTrace(
              parseError(errorMessage),
              currentStackTrace,
            )
            reject(err)
          } catch (e) {
            // If the ClickHouse response is malformed
            const err = enhanceStackTrace(e as Error, currentStackTrace)
            reject(err)
          }
        } else {
          return resolve({
            stream: responseStream,
            summary: params.parse_summary
              ? this.parseSummary(op, _response)
              : undefined,
            response_headers: { ..._response.headers },
            http_status_code: _response.statusCode ?? undefined,
          })
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
        const err = enhanceStackTrace(
          new Error('The user aborted a request.'),
          currentStackTrace,
        )
        reject(err)
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

        const callback = (e: NodeJS.ErrnoException | null): void => {
          if (e) {
            removeRequestListeners()
            const err = enhanceStackTrace(e, currentStackTrace)
            reject(err)
          }
        }

        if (params.enable_request_compression) {
          Stream.pipeline(bodyStream, Zlib.createGzip(), request, callback)
        } else {
          Stream.pipeline(bodyStream, request, callback)
        }
      }

      const onSocket = (socket: net.Socket) => {
        try {
          if (
            this.params.keep_alive.enabled &&
            this.params.keep_alive.idle_socket_ttl > 0
          ) {
            const socketInfo = this.knownSockets.get(socket)
            // It is the first time we've encountered this socket,
            // so it doesn't have the idle timeout handler attached to it
            if (socketInfo === undefined) {
              const socket_id = this.getNewSocketId()
              if (log_level <= ClickHouseLogLevel.TRACE) {
                log_writer.trace({
                  message: `${op}: using a fresh socket, setting up a new 'free' listener`,
                  args: {
                    operation: op,
                    connection_id: this.connectionId,
                    query_id,
                    request_id,
                    socket_id,
                  },
                })
              }
              const newSocketInfo: SocketInfo = {
                id: socket_id,
                idle_timeout_handle: undefined,
                usage_count: 1,
              }
              this.knownSockets.set(socket, newSocketInfo)
              // When the request is complete and the socket is released,
              // make sure that the socket is removed after `idleSocketTTL`.
              socket.on('free', () => {
                if (log_level <= ClickHouseLogLevel.TRACE) {
                  log_writer.trace({
                    message: `${op}: socket was released`,
                    args: {
                      operation: op,
                      connection_id: this.connectionId,
                      query_id,
                      request_id,
                      socket_id,
                    },
                  })
                }
                // Avoiding the built-in socket.timeout() method usage here,
                // as we don't want to clash with the actual request timeout.
                const idleTimeoutHandle = setTimeout(() => {
                  if (log_level <= ClickHouseLogLevel.TRACE) {
                    log_writer.trace({
                      message: `${op}: removing idle socket`,
                      args: {
                        operation: op,
                        connection_id: this.connectionId,
                        query_id,
                        request_id,
                        socket_id,
                        idle_socket_ttl_ms: this.idleSocketTTL,
                      },
                    })
                  }
                  this.knownSockets.delete(socket)
                  socket.destroy()
                }, this.idleSocketTTL).unref()
                newSocketInfo.idle_timeout_handle = idleTimeoutHandle
              })

              const cleanup = (eventName: string) => () => {
                const maybeSocketInfo = this.knownSockets.get(socket)
                // clean up a possibly dangling idle timeout handle (preventing leaks)
                if (maybeSocketInfo?.idle_timeout_handle) {
                  clearTimeout(maybeSocketInfo.idle_timeout_handle)
                }
                if (log_level <= ClickHouseLogLevel.TRACE) {
                  log_writer.trace({
                    message: `${op}: received '${eventName}' event, 'free' listener removed`,
                    args: {
                      operation: op,
                      connection_id: this.connectionId,
                      query_id,
                      request_id,
                      socket_id,
                      event: eventName,
                    },
                  })
                }

                if (log_level <= ClickHouseLogLevel.WARN) {
                  if (responseStream && !responseStream.readableEnded) {
                    log_writer.warn({
                      message:
                        `${op}: socket was closed or ended before the response was fully read. ` +
                        'This can potentially result in an uncaught ECONNRESET error! ' +
                        'Consider fully consuming, draining, or destroying the response stream.',
                      args: {
                        operation: op,
                        connection_id: this.connectionId,
                        query_id,
                        request_id,
                        socket_id,
                        event: eventName,
                        query: this.params.unsafeLogUnredactedQueries
                          ? params.query
                          : undefined,
                      },
                    })
                  }
                }
              }
              socket.once('end', cleanup('end'))
              socket.once('close', cleanup('close'))
            } else {
              clearTimeout(socketInfo.idle_timeout_handle)
              socketInfo.idle_timeout_handle = undefined
              if (log_level <= ClickHouseLogLevel.TRACE) {
                log_writer.trace({
                  message: `${op}: reusing socket`,
                  args: {
                    operation: op,
                    connection_id: this.connectionId,
                    query_id,
                    request_id,
                    socket_id: socketInfo.id,
                    usage_count: socketInfo.usage_count,
                  },
                })
              }
              socketInfo.usage_count++
            }
          }
        } catch (e) {
          if (log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: `${op}: an error occurred while housekeeping the idle sockets`,
              err: e as Error,
              args: {
                operation: op,
                connection_id: this.connectionId,
                query_id,
                request_id,
              },
            })
          }
        }

        // Socket is "prepared" with idle handlers, continue with our request
        pipeStream()

        // This is for request timeout only. Surprisingly, it is not always enough to set in the HTTP request.
        // The socket won't be destroyed, and it will be returned to the pool.
        if (log_level <= ClickHouseLogLevel.TRACE) {
          const socketInfo = this.knownSockets.get(socket)
          if (socketInfo) {
            log_writer.trace({
              message: `${op}: setting up request timeout`,
              args: {
                operation: op,
                connection_id: this.connectionId,
                query_id,
                request_id,
                socket_id: socketInfo.id,
                timeout_ms: requestTimeout,
              },
            })
          } else {
            log_writer.trace({
              message: `${op}: setting up request timeout on a socket`,
              args: {
                operation: op,
                connection_id: this.connectionId,
                query_id,
                request_id,
                timeout_ms: requestTimeout,
              },
            })
          }
        }
        socket.setTimeout(this.params.request_timeout, onTimeout)
      }

      const onTimeout = (): void => {
        removeRequestListeners()

        if (log_level <= ClickHouseLogLevel.TRACE) {
          const socket = request.socket
          const maybeSocketInfo = socket
            ? this.knownSockets.get(socket)
            : undefined

          const socketState = request.socket
            ? {
                connecting: request.socket.connecting,
                pending: request.socket.pending,
                destroyed: request.socket.destroyed,
                readyState: request.socket.readyState,
              }
            : undefined
          const responseStreamState = responseStream
            ? {
                readable: responseStream.readable,
                readableEnded: responseStream.readableEnded,
                readableLength: responseStream.readableLength,
              }
            : undefined

          log_writer.trace({
            message: `${op}: timeout occurred`,
            args: {
              operation: op,
              connection_id: this.connectionId,
              query_id,
              request_id,
              socket_id: maybeSocketInfo?.id,
              timeout_ms: requestTimeout,
              socket_state: socketState,
              response_stream_state: responseStreamState,
              has_response_stream: responseStream !== undefined,
            },
          })
        }

        const err = enhanceStackTrace(
          new Error('Timeout error.'),
          currentStackTrace,
        )
        try {
          request.destroy()
        } catch (e) {
          if (log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: `${op}: An error occurred while destroying the request`,
              err: e as Error,
              args: {
                operation: op,
                connection_id: this.connectionId,
                query_id,
                request_id,
              },
            })
          }
        }
        reject(err)
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
        params.abort_signal.addEventListener('abort', onAbort, {
          once: true,
        })
      }

      if (!params.body) {
        try {
          return request.end()
        } catch (e) {
          if (log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: `${op}: an error occurred while ending the request without body`,
              err: e as Error,
              args: {
                operation: op,
                connection_id: this.connectionId,
                query_id,
                request_id,
              },
            })
          }
        }
      }
    })
  }
}

interface RequestResult {
  stream: Stream.Readable
  response_headers: ResponseHeaders
  http_status_code?: number
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
  usage_count: number
}

type RunExecParams = ConnBaseQueryParams & {
  query_id: string
  op: 'Exec' | 'Command'
  values?: ConnExecParams<Stream.Readable>['values']
  decompress_response_stream?: boolean
  ignore_error_response?: boolean
}

const PingQuery = `SELECT 'ping'`
