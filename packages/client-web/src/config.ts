import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseSpan,
  CompressionSettings,
  ConnectionParams,
  DataFormat,
  ImplementationDetails,
  JSONHandling,
  ResponseHeaders,
} from "./common/index";
import { WebConnection } from "./connection";
import { ResultSet } from "./result_set";
import { WebValuesEncoder } from "./utils";

export type WebClickHouseClientConfigOptions =
  BaseClickHouseClientConfigOptions & {
    /** A custom implementation or wrapper over the global `fetch` method that will be used by the client internally.
     *  This might be helpful if you want to configure mTLS or change other default `fetch` settings. */
    fetch?: typeof fetch;
  };

/** The `zstd` codec is Node-only: the Web client does not compress request
 *  bodies, and relies on the browser to negotiate / decompress responses, so it
 *  cannot honor `{ codec: "zstd" }`. Fail fast at client creation rather than
 *  silently emitting an `Accept-Encoding: zstd` the client can't fulfill. */
function ensureNoZstdCodec(compression: CompressionSettings): void {
  const directions = [
    ["request", compression.compress_request],
    ["response", compression.decompress_response],
  ] as const;
  for (const [direction, value] of directions) {
    if (value?.codec === "zstd") {
      throw new Error(
        `zstd ${direction} compression is not supported by @clickhouse/client-web; ` +
          `it is only available in @clickhouse/client (Node.js). Use gzip instead.`,
      );
    }
  }
}

export const WebImpl: ImplementationDetails<ReadableStream>["impl"] = {
  make_connection: (
    config: WebClickHouseClientConfigOptions,
    params: ConnectionParams,
  ) => {
    ensureNoZstdCodec(params.compression);
    return new WebConnection({
      ...params,
      fetch: config.fetch,
    });
  },
  make_result_set: ((
    stream: ReadableStream,
    format: DataFormat,
    query_id: string,
    _log_error: (err: Error) => void,
    response_headers: ResponseHeaders,
    jsonHandling: JSONHandling,
    span?: ClickHouseSpan,
  ) =>
    new ResultSet(
      stream,
      format,
      query_id,
      response_headers,
      jsonHandling,
      span,
    )) as any,
  values_encoder: (jsonHandling: JSONHandling) =>
    new WebValuesEncoder(jsonHandling),
};
