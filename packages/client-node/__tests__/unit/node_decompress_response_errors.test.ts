import { describe, it, expect, vi } from "vitest";
import type Http from "http";
import Stream from "stream";
import Zlib from "zlib";
import { setTimeout as sleep } from "timers/promises";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import { ClickHouseError, ResultSet } from "../../src";
import {
  decompressResponse,
  isDecompressionError,
} from "../../src/connection/compression";

// See https://github.com/ClickHouse/clickhouse-js/issues/1167

const compressors = {
  gzip: (bytes: Buffer) => Zlib.gzipSync(bytes),
  br: (bytes: Buffer) => Zlib.brotliCompressSync(bytes),
  ...(typeof Zlib.zstdCompressSync === "function"
    ? { zstd: (bytes: Buffer) => Zlib.zstdCompressSync(bytes) }
    : {}),
};

const text = Array.from({ length: 1000 }, (_, n) => `{"n":${n}}\n`).join("");
const message =
  "Code: 395. DB::Exception: boom. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)";
const errorRow = `{"exception": "${message}"}\n`;

function abortError() {
  return Object.assign(new Error("aborted"), { code: "ECONNRESET" });
}

/** A response with all the bytes in its buffer, like an `IncomingMessage`
 *  that the consumer did not read yet. */
function response(codec: string, bytes: Buffer) {
  const res = new Stream.Readable({ read() {} }) as Stream.Readable & {
    headers: Http.IncomingHttpHeaders;
  };
  res.headers = { "content-encoding": codec };
  for (let i = 0; i < bytes.length; i += 100) {
    res.push(bytes.subarray(i, i + 100));
  }
  return res;
}

function decompress(res: Stream.Readable) {
  const logger = new TestLogger();
  const errorSpy = vi.spyOn(logger, "error");
  const result = decompressResponse(
    res as Http.IncomingMessage,
    new LogWriter(logger, "test", ClickHouseLogLevel.ERROR),
    ClickHouseLogLevel.ERROR,
  );
  if (isDecompressionError(result)) throw result.error;
  return { stream: result.response, errorSpy };
}

async function readAll(stream: Stream.Readable) {
  const parts: Buffer[] = [];
  try {
    for await (const part of stream) parts.push(part);
  } catch (error) {
    return { text: Buffer.concat(parts).toString(), error };
  }
  return { text: Buffer.concat(parts).toString(), error: undefined };
}

describe.each(Object.entries(compressors))(
  "[Node.js] decompressResponse (%s) when the response fails",
  (codec, compress) => {
    it("gives the output for the bytes in the buffer of the response, then the error", async () => {
      const res = response(codec, compress(Buffer.from(text)));
      const { stream, errorSpy } = decompress(res);
      const error = abortError();
      res.destroy(error);
      const result = await readAll(stream);
      expect(result.text).toBe(text);
      expect(result.error).toBe(error);
      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it("gives the output for an incomplete compressed body, then the error", async () => {
      const compressed = compress(Buffer.from(text));
      const res = response(
        codec,
        compressed.subarray(0, compressed.length - 5),
      );
      const { stream } = decompress(res);
      res.destroy(abortError());
      const result = await readAll(stream);
      // zstd gives no output for an incomplete frame.
      expect(text.startsWith(result.text)).toBe(true);
      expect(result.error).toMatchObject({ code: "ECONNRESET" });
    });

    it("fails when the response closes with no error", async () => {
      const res = response(codec, compress(Buffer.from(text)));
      const { stream } = decompress(res);
      res.destroy();
      const result = await readAll(stream);
      expect(result.text).toBe(text);
      expect(result.error).toMatchObject({
        code: "ERR_STREAM_PREMATURE_CLOSE",
      });
    });

    it("fails when the response is already destroyed", async () => {
      const res = response(codec, compress(Buffer.from(text)));
      const error = abortError();
      // Nothing listens yet: without a listener, the error is uncaught.
      res.on("error", () => {});
      res.destroy(error);
      await sleep(0);
      const { stream } = decompress(res);
      const result = await readAll(stream);
      expect(result.error).toBe(error);
    });

    it("ends with no error when the response ends", async () => {
      const res = response(codec, compress(Buffer.from(text)));
      res.push(null);
      const { stream, errorSpy } = decompress(res);
      const result = await readAll(stream);
      expect(result).toEqual({ text, error: undefined });
      expect(errorSpy).not.toHaveBeenCalled();
    });

    it("destroys the response when the consumer stops before the end", async () => {
      const res = response(codec, compress(Buffer.from(text)));
      const { stream } = decompress(res);
      for await (const _ of stream) break;
      await sleep(0);
      expect(res.destroyed).toBe(true);
    });

    it("gives a slow ResultSet consumer all rows, then the server error, when the response is aborted after the error", async () => {
      const res = response(codec, compress(Buffer.from(text + errorRow)));
      const { stream } = decompress(res);
      setImmediate(() => res.destroy(abortError()));
      const rs = ResultSet.instance({
        stream,
        format: "JSONEachRow",
        query_id: "test",
        log_error: () => {},
        response_headers: {},
      });
      let rows = 0;
      const consume = async () => {
        for await (const batch of rs.stream()) {
          rows += batch.length;
          await sleep(1);
        }
      };
      await expect(consume()).rejects.toBeInstanceOf(ClickHouseError);
      expect(rows).toBe(1000);
    });
  },
);
