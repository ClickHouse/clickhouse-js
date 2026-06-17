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

  // Pipes the response through a decompressor, logging any pipeline error.
  const decompressWith = (
    decompressor: Stream.Transform,
  ): DecompressResponseResult => ({
    response: Stream.pipeline(response, decompressor, (err) => {
      if (err && log_level <= ClickHouseLogLevel.ERROR) {
        log_writer.error({
          message: "An error occurred while decompressing the response",
          err,
        });
      }
    }),
  });

  // No `Content-Encoding`: nothing to decompress.
  if (encoding === undefined) {
    return { response };
  }

  if (encoding === "gzip") {
    return decompressWith(Zlib.createGunzip());
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
    return decompressWith(Zlib.createZstdDecompress());
  }

  return { error: new Error(`Unexpected encoding: ${encoding}`) };
}

export function isDecompressionError(result: any): result is { error: Error } {
  return result.error !== undefined;
}

/** Returns the request-body compressor for the given codec. An optional `level`
 *  sets the codec-specific compression level (zlib level for gzip, zstd
 *  compression level for zstd); when omitted, the codec default is used. The
 *  exhaustive switch fails the build if a new codec is added to the type without
 *  a corresponding case here. */
export function createRequestCompressor(
  method: CompressionMethod,
  level?: number,
): Stream.Transform {
  switch (method) {
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
