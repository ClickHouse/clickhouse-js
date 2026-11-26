import type { LogWriter, RequestCompression } from "../common/index";
import { ClickHouseLogLevel } from "../common/index";
import type Http from "http";
import Stream from "stream";
import Zlib from "zlib";

type DecompressResponseResult =
  { response: Stream.Readable } | { error: Error };

export function decompressResponse(
  response: Stream.Readable,
  headers: Http.IncomingHttpHeaders,
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
): DecompressResponseResult {
  const encoding = headers["content-encoding"];

  // No `Content-Encoding`: nothing to decompress.
  if (encoding === undefined) {
    return { response };
  }

  if (encoding === "gzip") {
    return {
      response: decompress(
        response,
        Zlib.createGunzip(),
        log_writer,
        log_level,
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
      response: decompress(
        response,
        Zlib.createZstdDecompress(),
        log_writer,
        log_level,
      ),
    };
  }

  if (encoding === "br") {
    return {
      response: decompress(
        response,
        Zlib.createBrotliDecompress(),
        log_writer,
        log_level,
      ),
    };
  }

  return { error: new Error(`Unexpected encoding: ${encoding}`) };
}

/**
 * Pipes `response` through `decompressor`, the same as `Stream.pipeline`,
 * but when `response` fails, `decompressor` first gives the output for the
 * bytes that were received. The server aborts the connection after a
 * mid-stream error. With a slow consumer, the end of the response, with the
 * server error, can still be in the buffer of `response` at that time, and
 * `Stream.pipeline` discards it.
 */
function decompress(
  response: Stream.Readable,
  decompressor: Zlib.Gunzip | Zlib.ZstdDecompress | Zlib.BrotliDecompress,
  log_writer: LogWriter,
  log_level: ClickHouseLogLevel,
): Stream.Readable {
  // `finished` also reports a response that is already destroyed, and a
  // response that closes with no error. It calls back in the 'error' event,
  // while the response has its buffer.
  Stream.finished(response, (err) => {
    if (!err || decompressor.destroyed || decompressor.writableEnded) {
      return;
    }
    response.unpipe(decompressor);
    // A destroyed stream discards its buffer, but still has it when it
    // emits 'error'.
    for (let chunk = response.read(); chunk !== null; chunk = response.read()) {
      decompressor.write(chunk);
    }
    // The response is incomplete: flush the output, then fail.
    decompressor.flush(() => decompressor.destroy(err));
  });
  decompressor.on("error", (err) => {
    if (log_level <= ClickHouseLogLevel.ERROR) {
      log_writer.error({
        message: "An error occurred while decompressing the response",
        err,
      });
    }
  });
  // Releases the socket when the consumer stops before the end, or when the
  // decompression fails.
  decompressor.on("close", () => response.destroy());
  response.pipe(decompressor);
  return decompressor;
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
