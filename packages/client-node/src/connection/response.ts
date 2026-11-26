import type Http from "http";
import type Stream from "stream";
import {
  enhanceStackTrace,
  isSuccessfulResponse,
  parseError,
  ClickHouseLogLevel,
  type ClickHouseSummary,
  type ConnOperation,
  type JSONHandling,
  type LogWriter,
} from "../common/index";
import { getAsText } from "../utils";
import { decompressResponse, isDecompressionError } from "./compression";
import type { RequestParams, RequestResult } from "./socket_pool";

/** The parts of an HTTP response that the shared response handling needs.
 *  Each transport (`node:http` or undici) maps its own response to this shape. */
export interface TransportResponse {
  status_code: number | undefined;
  headers: Http.IncomingHttpHeaders;
  body: Stream.Readable;
}

export interface ResponseContext {
  op: ConnOperation;
  params: RequestParams;
  connection_id: string;
  request_id: string;
  current_stack_trace: string | undefined;
  json_handling: JSONHandling;
  log_writer: LogWriter;
  log_level: ClickHouseLogLevel;
}

/** Returns `true` when ClickHouse reports an error, either with the HTTP
 *  status code or with the `X-ClickHouse-Exception-Code` header. */
export function isFailedResponse(response: TransportResponse): boolean {
  return (
    !isSuccessfulResponse(response.status_code) ||
    response.headers["x-clickhouse-exception-code"] !== undefined
  );
}

/** Returns the response body stream, decompressed when it is necessary.
 *  The body of a failed response is always decompressed, so that the error
 *  message can be parsed. Throws when the response encoding is not supported. */
export function getResponseStream(
  ctx: ResponseContext,
  response: TransportResponse,
): Stream.Readable {
  const tryDecompressResponseStream =
    ctx.params.try_decompress_response_stream ?? true;
  const ignoreErrorResponse = ctx.params.ignore_error_response ?? false;
  if (
    tryDecompressResponseStream ||
    (isFailedResponse(response) && !ignoreErrorResponse)
  ) {
    const decompressionResult = decompressResponse(
      response.body,
      response.headers,
      ctx.log_writer,
      ctx.log_level,
    );
    if (isDecompressionError(decompressionResult)) {
      throw enhanceStackTrace(
        decompressionResult.error,
        ctx.current_stack_trace,
      );
    }
    return decompressionResult.response;
  }
  return response.body;
}

/** Builds the request result from the response stream. For a failed response,
 *  reads the error message from the stream and throws the parsed ClickHouse error. */
export async function getRequestResult(
  ctx: ResponseContext,
  response: TransportResponse,
  stream: Stream.Readable,
): Promise<RequestResult> {
  const ignoreErrorResponse = ctx.params.ignore_error_response ?? false;
  if (isFailedResponse(response) && !ignoreErrorResponse) {
    let errorMessage: string;
    try {
      errorMessage = await getAsText(stream);
    } catch (e) {
      // If the ClickHouse response is malformed
      throw enhanceStackTrace(e as Error, ctx.current_stack_trace);
    }
    throw enhanceStackTrace(parseError(errorMessage), ctx.current_stack_trace);
  }
  return {
    stream,
    summary: ctx.params.parse_summary
      ? parseSummary(ctx, response.headers)
      : undefined,
    response_headers: { ...response.headers },
    http_status_code: response.status_code ?? undefined,
  };
}

function parseSummary(
  ctx: ResponseContext,
  headers: Http.IncomingHttpHeaders,
): ClickHouseSummary | undefined {
  const summaryHeader = headers["x-clickhouse-summary"];
  if (typeof summaryHeader === "string") {
    try {
      return ctx.json_handling.parse(summaryHeader);
    } catch (err) {
      if (ctx.log_level <= ClickHouseLogLevel.ERROR) {
        ctx.log_writer.error({
          message: `${ctx.op}: failed to parse X-ClickHouse-Summary header.`,
          args: {
            operation: ctx.op,
            connection_id: ctx.connection_id,
            "X-ClickHouse-Summary": summaryHeader,
          },
          err: err as Error,
        });
      }
    }
  }
}
