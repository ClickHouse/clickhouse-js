import type { LogWriter, RequestCompression } from "@clickhouse/client-common";
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

  // No `Content-Encoding`: nothing to decompress.
  if (encoding === undefined) {
    return { response };
  }

  if (encoding === "gzip") {
    return {
      response: Stream.pipeline(
        response,
        Zlib.createGunzip(),
        function pipelineCb(err) {
          if (err && log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: "An error occurred while decompressing the response",
              err,
            });
          }
        },
      ),
    };
  }

  if (encoding === "zstd") {
    // zstd's zlib API was added in Node.js 22.15.0; on an older runtime the
    // codec is recognized but unusable, so report that explicitly rather than
    // falling through to a misleading "Unexpected encoding".
    if (typeof Zlib.createZstdDecompress !== "function") {
      return {
        error: new Error(
          "Received a zstd-compressed response, but this Node.js runtime (v" +
            process.versions.node +
            ") does not support zstd decompression: the built-in zlib module " +
            "does not provide the zstd APIs (added in Node.js 22.15.0). Use gzip " +
            "compression instead, or upgrade Node.js.",
        ),
      };
    }
    return {
      response: Stream.pipeline(
        response,
        Zlib.createZstdDecompress(),
        function pipelineCb(err) {
          if (err && log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: "An error occurred while decompressing the response",
              err,
            });
          }
        },
      ),
    };
  }

  if (encoding === "br") {
    return {
      response: Stream.pipeline(
        response,
        Zlib.createBrotliDecompress(),
        function pipelineCb(err) {
          if (err && log_level <= ClickHouseLogLevel.ERROR) {
            log_writer.error({
              message: "An error occurred while decompressing the response",
              err,
            });
          }
        },
      ),
    };
  }

  return { error: new Error(`Unexpected encoding: ${encoding}`) };
}

export function isDecompressionError(result: any): result is { error: Error } {
  return result.error !== undefined;
}

/** Returns the request-body compressor for the given config. Each codec carries
 *  its own optional tuning option - a `level` for gzip/zstd, a `quality` for
 *  Brotli; when omitted, the codec default is used (Brotli defaults to quality 4
 *  rather than zlib's slow default of 11, which is impractical for a streaming
 *  insert body). The exhaustive switch fails the build if a codec is added to
 *  {@link RequestCompression} without a corresponding case here. */
export function createRequestCompressor(
  compression: RequestCompression,
): Stream.Transform {
  switch (compression.codec) {
    case "gzip":
      return Zlib.createGzip(
        compression.level !== undefined
          ? { level: compression.level }
          : undefined,
      );
    case "zstd":
      return Zlib.createZstdCompress(
        compression.level !== undefined
          ? {
              params: {
                [Zlib.constants.ZSTD_c_compressionLevel]: compression.level,
              },
            }
          : undefined,
      );
    case "br":
      return Zlib.createBrotliCompress({
        params: {
          [Zlib.constants.BROTLI_PARAM_QUALITY]: compression.quality ?? 4,
        },
      });
    default: {
      const exhaustiveCheck: never = compression;
      throw new Error(
        `Unsupported request compression codec: ${String((exhaustiveCheck as { codec?: unknown }).codec)}`,
      );
    }
  }
}
