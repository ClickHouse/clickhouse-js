import type { CompressionMethod, LogWriter } from "@clickhouse/client-common";
import { ClickHouseLogLevel } from "@clickhouse/client-common";
import type Http from "http";
import Stream from "stream";
import Zlib from "zlib";

type DecompressResponseResult =
  | { response: Stream.Readable }
  | { error: Error };

export function decompressResponse(
  response: Http.IncomingMessage,
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
): DecompressResponseResult {
  const encoding = response.headers["content-encoding"];

  if (
    encoding === "gzip" ||
    (encoding === "zstd" && typeof Zlib.createZstdDecompress === "function")
  ) {
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
  } else if (encoding === "zstd") {
    // Reached only when the server returned a zstd-encoded body but this
    // Node.js runtime's zlib lacks the zstd APIs (added in 22.15.0) - so the
    // codec is recognized, just unusable here. Distinguish it from a truly
    // unknown encoding to avoid a misleading "Unexpected encoding" message.
    return {
      error: new Error(
        "Received a zstd-compressed response, but this Node.js runtime (v" +
          process.versions.node +
          ") does not support zstd decompression: the built-in zlib module " +
          "does not provide the zstd APIs (added in Node.js 22.15.0). Use gzip " +
          "compression instead, or upgrade Node.js.",
      ),
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

/** Returns the request-body compressor for the given codec (`true` == gzip, kept
 *  for backwards compatibility). An optional `level` sets the codec-specific
 *  compression level (zlib level for gzip, zstd compression level for zstd);
 *  when omitted, the codec default is used. The exhaustive switch fails the
 *  build if a new codec is added to the type without a corresponding case here. */
export function createRequestCompressor(
  method: true | CompressionMethod,
  level?: number,
): Stream.Transform {
  switch (method) {
    case true:
    case "gzip":
      return Zlib.createGzip(level !== undefined ? { level } : undefined);
    case "zstd":
      return Zlib.createZstdCompress(
        level !== undefined
          ? { params: { [Zlib.constants.ZSTD_c_compressionLevel]: level } }
          : undefined,
      );
    default: {
      const exhaustiveCheck: never = method;
      throw new Error(
        `Unsupported request compression codec: ${String(exhaustiveCheck)}`,
      );
    }
  }
}
