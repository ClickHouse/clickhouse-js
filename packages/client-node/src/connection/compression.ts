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
 *  for backwards compatibility). The exhaustive switch fails the build if a new
 *  codec is added to the type without a corresponding case here. */
export function createRequestCompressor(
  method: true | CompressionMethod,
): Stream.Transform {
  switch (method) {
    case true:
    case "gzip":
      return Zlib.createGzip();
    case "zstd":
      return Zlib.createZstdCompress();
    default: {
      const exhaustiveCheck: never = method;
      throw new Error(
        `Unsupported request compression codec: ${String(exhaustiveCheck)}`,
      );
    }
  }
}
