import type {
  BaseClickHouseClientConfigOptions,
  ClickHouseSpan,
  ConnectionParams,
  DataFormat,
  ImplementationDetails,
  JSONHandling,
  ResponseHeaders,
  URLOptions,
} from "./common/index";
import { numberConfigURLValue } from "./common/index";
import type Stream from "stream";
import { NativeConnection } from "./connection/native_connection";
import type { NativeTLSOptions } from "./connection/native_socket";
import type { NativeCompressionMethod } from "./compression/frames";
import { isZstdAvailable } from "./compression/frames";
import { ResultSet } from "./result_set";
import { NodeValuesEncoder } from "./utils";

export type NativeClickHouseClientConfigOptions = Omit<
  BaseClickHouseClientConfigOptions,
  "url" | "compression"
> & {
  /** Compression of the data blocks in both directions: `lz4` or `zstd`.
   *  The client asks the server to use the same method for its data (if the
   *  user can change settings). `zstd` needs Node.js 22.15.0 or later.
   *  `zstd` gives smaller data than `lz4`. The speed of the two methods
   *  depends on the data.
   *  @default "none" */
  compression?: "none" | NativeCompressionMethod;
  /** The URL of the native protocol port of the server:
   *  `tcp://[username:password@]host[:port][/database]`, or `tcps://...` for TLS.
   *  The default port is 9000 for `tcp`, and 9440 for `tcps`.
   *  @default tcp://localhost:9000 */
  url?: string | URL;
  /** TLS options for a `tcps://` URL. Without them, the client uses the
   *  certificate authorities of Node.js. */
  tls?: BasicTLSOptions | MutualTLSOptions;
  /** How long to wait for a new connection and its handshake (in milliseconds).
   *  @default 10_000 */
  connect_timeout?: number;
};

interface BasicTLSOptions {
  ca_cert: Buffer;
}

interface MutualTLSOptions {
  ca_cert: Buffer;
  cert: Buffer;
  key: Buffer;
}

export const NativeURLOptions: URLOptions = {
  default_url: "tcp://localhost:9000",
  protocols: ["tcp:", "tcps:"],
};

export const NativeConfigImpl: Required<
  ImplementationDetails<Stream.Readable>["impl"]
> = {
  url_options: NativeURLOptions,
  handle_specific_url_params: (config, url) => {
    const nativeConfig = {
      ...config,
    } as unknown as NativeClickHouseClientConfigOptions;
    const unknown_params = new Set<string>();
    const handled_params = new Set<string>();
    for (const key of [...url.searchParams.keys()]) {
      const value = url.searchParams.get(key) as string;
      switch (key) {
        case "compression":
          if (value !== "none" && value !== "lz4" && value !== "zstd") {
            throw new Error(
              `"compression" URL parameter must be one of none, lz4, zstd. Got: ${value}`,
            );
          }
          nativeConfig.compression = value;
          handled_params.add(key);
          break;
        case "connect_timeout":
          nativeConfig.connect_timeout = numberConfigURLValue({
            key,
            value,
            min: 0,
          });
          handled_params.add(key);
          break;
        default:
          unknown_params.add(key);
      }
    }
    return {
      config: nativeConfig as BaseClickHouseClientConfigOptions,
      unknown_params,
      handled_params,
    };
  },
  make_connection: (
    config: BaseClickHouseClientConfigOptions,
    params: ConnectionParams,
  ) => {
    const nativeConfig = config as NativeClickHouseClientConfigOptions;
    let tls: NativeTLSOptions | undefined = undefined;
    if (nativeConfig.tls !== undefined) {
      tls =
        "cert" in nativeConfig.tls && "key" in nativeConfig.tls
          ? { type: "Mutual", ...nativeConfig.tls }
          : { type: "Basic", ...nativeConfig.tls };
    }
    const compression = nativeConfig.compression ?? "none";
    if (
      compression !== "none" &&
      compression !== "lz4" &&
      compression !== "zstd"
    ) {
      throw new Error(
        `The native protocol client supports the compression methods none, lz4 and zstd. Got: ${JSON.stringify(compression)}`,
      );
    }
    if (compression === "zstd" && !isZstdAvailable()) {
      throw new Error(
        "zstd compression is not supported by this Node.js runtime (v" +
          process.versions.node +
          "): the zstd APIs of zlib were added in Node.js 22.15.0. Use lz4 instead.",
      );
    }
    return new NativeConnection({
      ...params,
      compression_method: compression === "none" ? undefined : compression,
      tls,
      connect_timeout: nativeConfig.connect_timeout ?? 10_000,
    });
  },
  values_encoder: (json) => new NodeValuesEncoder(json),
  make_result_set: ((
    stream: Stream.Readable,
    format: DataFormat,
    query_id: string,
    log_error: (err: Error) => void,
    response_headers: ResponseHeaders,
    jsonHandling: JSONHandling,
    span?: ClickHouseSpan,
  ) =>
    ResultSet.instance({
      stream,
      format,
      query_id,
      log_error,
      response_headers,
      jsonHandling,
      span,
    })) as any,
};
