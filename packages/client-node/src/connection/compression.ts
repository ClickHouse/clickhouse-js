import type {
  CompressionSettings,
  LogWriter,
  RequestCompressionMethod,
} from "@clickhouse/client-common";
import { ClickHouseLogLevel } from "@clickhouse/client-common";
import type Http from "http";
import Stream from "stream";
import Zlib from "zlib";

const ZSTD_UNSUPPORTED_MESSAGE =
  "zstd compression requires Node.js >= 22.15.0, where zstd support was added " +
  "to the built-in zlib module. Upgrade Node.js, or use gzip compression instead.";

/** Throws a clear error if the compression settings require zstd but the current
 *  Node.js runtime's `zlib` does not provide it (zstd was added in v22.15.0). */
export function validateCompressionSupport(
  compression: CompressionSettings,
): void {
  if (
    compression.compress_request === "zstd" &&
    typeof Zlib.createZstdCompress !== "function"
  ) {
    throw new Error(ZSTD_UNSUPPORTED_MESSAGE);
  }
  if (
    compression.decompress_response === "zstd" &&
    typeof Zlib.createZstdDecompress !== "function"
  ) {
    throw new Error(ZSTD_UNSUPPORTED_MESSAGE);
  }
}

/** Returns the request-body compressor for the configured codec, throwing a
 *  clear error (rather than a TypeError) if zstd is unavailable in this runtime. */
export function createRequestCompressor(
  method: boolean | RequestCompressionMethod,
): Stream.Transform {
  if (method === "zstd") {
    if (typeof Zlib.createZstdCompress !== "function") {
      throw new Error(ZSTD_UNSUPPORTED_MESSAGE);
    }
    return Zlib.createZstdCompress();
  }
  return Zlib.createGzip();
}

type DecompressResponseResult =
  | { response: Stream.Readable }
  | { error: Error };

export function decompressResponse(
  response: Http.IncomingMessage,
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
): DecompressResponseResult {
  const encoding = response.headers["content-encoding"];

  if (encoding === "gzip" || encoding === "zstd") {
    if (
      encoding === "zstd" &&
      typeof Zlib.createZstdDecompress !== "function"
    ) {
      return { error: new Error(ZSTD_UNSUPPORTED_MESSAGE) };
    }
    const decompress =
      encoding === "zstd" ? Zlib.createZstdDecompress() : Zlib.createGunzip();
    return {
      response: Stream.pipeline(response, decompress, function pipelineCb(err) {
        if (err) {
          if (log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: "An error occurred while decompressing the response",
              err,
            });
          }
        }
      }),
    };
  } else if (encoding !== undefined) {
    return {
      error: new Error(`Unexpected encoding: ${encoding}`),
    };
  }

  return { response };
}

export function isDecompressionError(result: any): result is { error: Error } {
  return result.error !== undefined;
}
