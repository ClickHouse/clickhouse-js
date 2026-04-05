import type Http from 'http'
import Stream from 'stream'
import type * as net from 'net'
import Zlib from 'zlib'
import {
  enhanceStackTrace,
  getCurrentStackTrace,
  isSuccessfulResponse,
  parseError,
  sleep,
  ClickHouseLogLevel,
  type LogWriter,
  type ConnOperation,
  type ResponseHeaders,
  type ClickHouseSummary,
  type JSONHandling,
} from '@clickhouse/client-common'
import { getAsText, isStream } from '../utils'
import { decompressResponse, isDecompressionError } from './compression'
import { type NodeConnectionParams } from './node_base_connection'

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

export interface RequestResult {
  stream: Stream.Readable
  response_headers: ResponseHeaders
  http_status_code?: number
  summary?: ClickHouseSummary
}

interface SocketInfo {
  id: string
  idle_timeout_handle: ReturnType<typeof setTimeout> | undefined
  usage_count: number
  server_keep_alive_timeout_ms?: number
  freed_at_timestamp_ms?: number
}

type CreateClientRequest = (params: RequestParams) => Http.ClientRequest

export class SocketPool {
  private readonly jsonHandling: JSONHandling
  private readonly knownSockets = new WeakMap<net.Socket, SocketInfo>()

  // For overflow concerns:
  //   node -e 'console.log(Number.MAX_SAFE_INTEGER / (1_000_000 * 60 * 60 * 24 * 366))'
  // gives 284 years of continuous operation at 1M requests per second
  // before overflowing the 53-bit integer
  private requestCounter = 0
  private getNewRequestId(): string {
    this.requestCounter += 1
    return `${this.connectionId}:${this.requestCounter}`
  }

  private socketCounter = 0
  private getNewSocketId(): string {
    this.socketCounter += 1
    return `${this.connectionId}:${this.socketCounter}`
  }

  constructor(
    private readonly connectionId: string,
    private readonly params: NodeConnectionParams,
    private readonly createClientRequest: CreateClientRequest,
    private readonly agent: Http.Agent,
  ) {
    this.jsonHandling = params.json ?? {
      parse: JSON.parse,
      stringify: JSON.stringify,
    }
  }

  async request(
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

    if (this.params.eagerly_destroy_stale_sockets) {
      // Just checking in case of a custom agent with a different implementation
      if (this.agent.freeSockets) {
        for (const host of Object.keys(this.agent.freeSockets)) {
          const byHostSockets = this.agent.freeSockets[host]
          if (byHostSockets) {
            for (const socket of byHostSockets) {
              const socketInfo = this.knownSockets.get(socket)
              if (socketInfo) {
                const freedAt = socketInfo.freed_at_timestamp_ms
                if (freedAt) {
                  const socketAge = Date.now() - freedAt
                  // The check below is still racy on a CPU starved machine.
                  // A throttled machine can check time on one line, then get descheduled,
                  // decide the socket is still good after rescheduling, and then proceed
                  // to use a socket that has actually been idle for much longer than `idle_socket_ttl`.
                  // However, this is an edge case that should be clearly visible in the
                  // application monitoring.
                  if (socketAge >= this.params.keep_alive.idle_socket_ttl) {
                    if (log_level <= ClickHouseLogLevel.TRACE) {
                      log_writer.trace({
                        message: `${op}: socket TTL expired based on timestamp, destroying socket`,
                        args: {
                          operation: op,
                          connection_id: this.connectionId,
                          query_id,
                          socket_id: socketInfo.id,
                          socket_age_ms: socketAge,
                          idle_socket_ttl_ms:
                            this.params.keep_alive.idle_socket_ttl,
                        },
                      })
                    }
                    clearTimeout(socketInfo.idle_timeout_handle)
                    this.knownSockets.delete(socket)
                    socket.destroy()
                  }
                }
              }
            }
          }
        }
      }
    }

    const start = Date.now()
    const request = this.createClientRequest(params)
    const request_id = this.getNewRequestId()
    return new Promise((resolve, reject) => {
      const onError = (e: unknown): void => {
        removeRequestListeners()
        if (e instanceof Error) {
          if (log_level <= ClickHouseLogLevel.TRACE) {
            if ((e as any).code === 'ECONNRESET') {
              log_writer.trace({
                message: `${op}: connection reset by peer`,
                args: {
                  operation: op,
                  connection_id: this.connectionId,
                  query_id,
                  request_id,
                },
                module: 'HTTP Adapter',
              })
            }
          }
          if (log_level <= ClickHouseLogLevel.WARN) {
            if (this.params.keep_alive.enabled) {
              if ((e as any).code === 'ECONNRESET') {
                const socket = request.socket
                if (socket) {
                  const socketInfo = this.knownSockets.get(socket)
                  if (socketInfo) {
                    const serverTimeoutMs =
                      socketInfo.server_keep_alive_timeout_ms
                    if (serverTimeoutMs !== undefined) {
                      if (
                        this.params.keep_alive.idle_socket_ttl > serverTimeoutMs
                      ) {
                        log_writer.warn({
                          message: `${op}: idle socket TTL is greater than server keep-alive timeout, try setting idle socket TTL to a value lower than the server keep-alive timeout to prevent unexpected connection resets, see https://c.house/js_keep_alive_econnreset for more details.`,
                          args: {
                            operation: op,
                            connection_id: this.connectionId,
                            query_id,
                            request_id,
                            socket_id: socketInfo.id,
                            server_keep_alive_timeout_ms: serverTimeoutMs,
                            idle_socket_ttl:
                              this.params.keep_alive.idle_socket_ttl,
                          },
                          module: 'HTTP Adapter',
                        })
                      }
                    }
                  }
                }
              }
            }
          }

          const err = enhanceStackTrace(e, currentStackTrace)
          reject(err)
        } else {
          reject(e)
        }
      }

      let responseStream: Stream.Readable
      const onResponse = async (
        _response: Http.IncomingMessage,
      ): Promise<void> => {
        if (this.params.log_level <= ClickHouseLogLevel.DEBUG) {
          const duration = Date.now() - start
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
              response_status: _response.statusCode,
              response_time_ms: duration,
            },
          })
        }

        if (this.params.keep_alive.enabled) {
          const keepAliveHeader = _response.headers['keep-alive']
          if (keepAliveHeader) {
            const [, timeout] =
              /timeout=(\d+)/i.exec(String(keepAliveHeader)) ?? []

            if (timeout) {
              const socketInfo = this.knownSockets.get(_response.socket)
              if (socketInfo) {
                const timeoutMs = Number(timeout) * 1000
                socketInfo.server_keep_alive_timeout_ms = timeoutMs
                if (log_level <= ClickHouseLogLevel.TRACE) {
                  this.params.log_writer.trace({
                    module: 'HTTP Adapter',
                    message: `${op}: updated server sent socket keep-alive timeout`,
                    args: {
                      operation: op,
                      connection_id: this.connectionId,
                      query_id,
                      request_id,
                      socket_id: socketInfo.id,
                      server_keep_alive_timeout_ms: timeoutMs,
                    },
                  })
                }
              }
            }
          }
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
              // make sure that the socket is removed after `idle_socket_ttl`.
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
                const freed_at_timestamp_ms = Date.now()
                newSocketInfo.freed_at_timestamp_ms = freed_at_timestamp_ms
                // Avoiding the built-in socket.timeout() method usage here,
                // as we don't want to clash with the actual request timeout.
                const idleTimeoutHandle = setTimeout(() => {
                  const freedAfter = Date.now() - freed_at_timestamp_ms
                  if (log_level <= ClickHouseLogLevel.TRACE) {
                    log_writer.trace({
                      message: `${op}: removing idle socket`,
                      args: {
                        operation: op,
                        connection_id: this.connectionId,
                        query_id,
                        request_id,
                        socket_id,
                        idle_socket_ttl_ms:
                          this.params.keep_alive.idle_socket_ttl,
                        freed_after_ms: freedAfter,
                      },
                    })
                  }
                  this.knownSockets.delete(socket)
                  socket.destroy()
                }, this.params.keep_alive.idle_socket_ttl).unref()
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
                      },
                    })
                  }
                }
              }
              socket.once('end', cleanup('end'))
              socket.once('close', cleanup('close'))
            } else {
              const freedAt = socketInfo.freed_at_timestamp_ms
              if (freedAt) {
                // On a CPU throttled machine or when event loop is delayed,
                // the socket can be idle for much longer than `idle_socket_ttl`
                // as the timers don't fire exactly on time which can lead
                // to a stale socket being reused.
                const socketAge = Date.now() - freedAt
                if (socketAge >= this.params.keep_alive.idle_socket_ttl) {
                  if (log_level <= ClickHouseLogLevel.WARN) {
                    log_writer.warn({
                      message: `${op}: reusing socket with TTL expired based on timestamp; this may indicate a starved Node.js process or delayed event loop; set keep_alive.eagerly_destroy_stale_sockets=true to mitigate`,
                      args: {
                        operation: op,
                        connection_id: this.connectionId,
                        query_id,
                        socket_id: socketInfo.id,
                        socket_age_ms: socketAge,
                        idle_socket_ttl_ms:
                          this.params.keep_alive.idle_socket_ttl,
                      },
                    })
                  }
                }
              }

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
        if (request.socket) {
          request.socket.setTimeout(0) // reset previously set timeout
          request.socket.removeListener('timeout', onTimeout)
        }
        request.removeListener('socket', onSocket)
        request.removeListener('response', onResponse)
        request.removeListener('error', onError)
        request.removeListener('close', onClose)
        if (params.abort_signal) {
          request.removeListener('abort', onAbort)
        }
      }

      request.on('socket', onSocket)
      request.on('response', onResponse)
      request.on('error', onError)
      request.on('close', onClose)

      if (params.abort_signal) {
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
}
