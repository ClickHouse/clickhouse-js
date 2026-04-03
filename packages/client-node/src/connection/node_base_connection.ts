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
  ResponseHeaders,
} from '@clickhouse/client-common'
import {
  isCredentialsAuth,
  isJWTAuth,
  toSearchParams,
  transformUrl,
  withHttpSettings,
  ClickHouseLogLevel,
} from '@clickhouse/client-common'
import { type ConnPingParams } from '@clickhouse/client-common'
import crypto from 'crypto'
import type Http from 'http'
import type Https from 'node:https'
import type Stream from 'stream'
import { getUserAgent } from '../utils'
import { drainStreamInternal } from './stream'
import { type RequestParams, SocketPool } from './socket_pool'

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

export abstract class NodeBaseConnection implements Connection<Stream.Readable> {
  protected readonly defaultAuthHeader: string
  protected readonly defaultHeaders: Http.OutgoingHttpHeaders

  private readonly connectionId: string = crypto.randomUUID()
  private readonly socketPool: SocketPool

  protected constructor(
    protected readonly params: NodeConnectionParams,
    protected readonly agent: Http.Agent,
  ) {
    this.socketPool = new SocketPool(
      this.connectionId,
      this.params,
      this.createClientRequest.bind(this),
    )
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
  }

  async ping(params: ConnPingParams): Promise<ConnPingResult> {
    const { log_writer, log_level } = this.params
    const query_id = this.getQueryId(params.query_id)
    const { controller, controllerCleanup } = this.getAbortController(params)
    try {
      let result: RequestResult
      if (params.select) {
        const searchParams = toSearchParams({
          database: undefined,
          query: PingQuery,
          query_id,
        })
        result = await this.request(
          {
            query: PingQuery,
            method: 'GET',
            url: transformUrl({ url: this.params.url, searchParams }),
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
            query: 'ping',
            method: 'GET',
            url: transformUrl({ url: this.params.url, pathname: '/ping' }),
            abort_signal: controller.signal,
            headers: this.buildRequestHeaders(),
            query_id,
            log_writer,
            log_level,
          },
          'Ping',
        )
      }
      await drainStreamInternal(
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
      await drainStreamInternal(
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
    await drainStreamInternal(
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
    extra_args,
  }: LogRequestErrorParams) {
    if (this.params.log_level <= ClickHouseLogLevel.ERROR) {
      this.params.log_writer.error({
        message: this.httpRequestErrorMessage(op),
        err: err as Error,
        args: {
          operation: op,
          connection_id: this.connectionId,
          query_id,
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
    return this.socketPool.request(params, op)
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

type RunExecParams = ConnBaseQueryParams & {
  query_id: string
  op: 'Exec' | 'Command'
  values?: ConnExecParams<Stream.Readable>['values']
  decompress_response_stream?: boolean
  ignore_error_response?: boolean
}

const PingQuery = `SELECT 'ping'`
