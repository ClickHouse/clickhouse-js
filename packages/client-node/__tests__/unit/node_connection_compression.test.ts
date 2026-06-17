import { describe, it, expect, beforeEach, vi } from "vitest";
import { sleep } from "../utils/sleep";
import Http, { type ClientRequest } from "http";
import Stream from "stream";
import Zlib from "zlib";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import { assertConnQueryResult } from "../utils/assert";
import {
  createRequestCompressor,
  decompressResponse,
  isDecompressionError,
} from "../../src/connection/compression";
import {
  buildHttpConnection,
  buildIncomingMessage,
  emitCompressedBody,
  emitResponseBody,
  socketStub,
  stubClientRequest,
} from "../utils/http_stubs";

const zstdSupported =
  typeof Zlib.createZstdCompress === "function" &&
  typeof Zlib.createZstdDecompress === "function" &&
  typeof Zlib.zstdCompressSync === "function" &&
  typeof Zlib.zstdDecompress === "function";

beforeEach(() => {
  vi.clearAllMocks();
});

const httpRequestStub = vi.spyOn(Http, "request");

describe("Node.js Connection compression", () => {
  describe("response decompression", () => {
    it("hints ClickHouse server to send a gzip compressed response if compress_request: true", async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: { codec: "gzip" },
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
      });

      const responseBody = "foobar";
      await emitCompressedBody(request, responseBody);

      await selectPromise;

      expect(httpRequestStub).toHaveBeenCalledTimes(1);
      const calledWith =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
      expect(
        (calledWith.headers as Record<string, string>)["Accept-Encoding"],
      ).toBe("gzip");
    });

    it("does not send a compression algorithm hint if compress_request: false", async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: undefined,
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
      });

      const responseBody = "foobar";
      await emitResponseBody(request, responseBody);

      const queryResult = await selectPromise;
      await assertConnQueryResult(queryResult, responseBody);

      expect(httpRequestStub).toHaveBeenCalledTimes(1);
      const calledWith =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
      expect(
        (calledWith.headers as Record<string, string | undefined>)[
          "Accept-Encoding"
        ],
      ).toBe(undefined);
    });

    it("uses request-specific settings over config settings", async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: undefined,
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
        clickhouse_settings: {
          enable_http_compression: 1,
        },
      });

      const responseBody = "foobar";
      await emitCompressedBody(request, responseBody);

      const queryResult = await selectPromise;
      await assertConnQueryResult(queryResult, responseBody);

      expect(httpRequestStub).toHaveBeenCalledTimes(1);
      const calledWith =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
      expect(
        (calledWith.headers as Record<string, string>)["Accept-Encoding"],
      ).toBe("gzip");
    });

    it("decompresses a gzip response", async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: { codec: "gzip" },
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
      });

      const responseBody = "abc".repeat(1_000);
      await emitCompressedBody(request, responseBody);

      const queryResult = await selectPromise;
      await assertConnQueryResult(queryResult, responseBody);
    });

    it("returns a clear error for a zstd response on a runtime without zstd support", () => {
      // Simulate a Node.js runtime whose zlib lacks the zstd APIs (< 22.15.0).
      const original = Object.getOwnPropertyDescriptor(
        Zlib,
        "createZstdDecompress",
      );
      Object.defineProperty(Zlib, "createZstdDecompress", {
        value: undefined,
        configurable: true,
      });
      try {
        const response = buildIncomingMessage({
          body: "anything",
          headers: { "content-encoding": "zstd" },
        });
        const logWriter = new LogWriter(
          new TestLogger(),
          "test",
          ClickHouseLogLevel.OFF,
        );
        const result = decompressResponse(
          response,
          logWriter,
          ClickHouseLogLevel.OFF,
        );
        expect(isDecompressionError(result)).toBe(true);
        expect((result as { error: Error }).error.message).toContain(
          "does not support zstd decompression",
        );
        expect((result as { error: Error }).error.message).not.toContain(
          "Unexpected encoding",
        );
      } finally {
        if (original) {
          Object.defineProperty(Zlib, "createZstdDecompress", original);
        } else {
          // No original descriptor (runtime genuinely lacks zstd): remove the
          // stub we added instead of leaving an `undefined` property behind.
          delete (Zlib as unknown as Record<string, unknown>)[
            "createZstdDecompress"
          ];
        }
      }
    });

    it("throws on an unexpected encoding", async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: { codec: "gzip" },
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
      });

      await emitCompressedBody(request, "abc", "lz4");

      await expect(selectPromise).rejects.toEqual(
        expect.objectContaining({
          message: "Unexpected encoding: lz4",
        }),
      );
    });

    it("provides decompression error to a stream consumer", async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: { codec: "gzip" },
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
      });

      // No GZIP encoding for the body here
      await sleep(0);
      request.emit(
        "response",
        buildIncomingMessage({
          body: "abc",
          headers: {
            "content-encoding": "gzip",
          },
        }),
      );

      const readStream = async () => {
        const { stream } = await selectPromise;
        for await (const chunk of stream) {
          void chunk; // stub
        }
      };

      await expect(readStream()).rejects.toEqual(
        expect.objectContaining({
          message: "incorrect header check",
          code: "Z_DATA_ERROR",
        }),
      );
    });

    it.skipIf(!zstdSupported)(
      'decompresses a zstd response and sends Accept-Encoding: zstd if response: "zstd"',
      async () => {
        const request = stubClientRequest();
        httpRequestStub.mockReturnValue(request);

        const adapter = buildHttpConnection({
          compression: {
            decompress_response: { codec: "zstd" },
            compress_request: undefined,
          },
        });

        const selectPromise = adapter.query({
          query: "SELECT * FROM system.numbers LIMIT 5",
        });

        const responseBody = "foobar";
        await sleep(0);
        request.emit(
          "response",
          buildIncomingMessage({
            body: Zlib.zstdCompressSync(Buffer.from(responseBody)),
            headers: { "content-encoding": "zstd" },
          }),
        );

        const queryResult = await selectPromise;
        await assertConnQueryResult(queryResult, responseBody);

        expect(httpRequestStub).toHaveBeenCalledTimes(1);
        const calledWith =
          httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
        expect(
          (calledWith.headers as Record<string, string>)["Accept-Encoding"],
        ).toBe("zstd");
      },
    );

    it('decompresses a br response and sends Accept-Encoding: br if response: { codec: "br" }', async () => {
      const request = stubClientRequest();
      httpRequestStub.mockReturnValue(request);

      const adapter = buildHttpConnection({
        compression: {
          decompress_response: { codec: "br" },
          compress_request: undefined,
        },
      });

      const selectPromise = adapter.query({
        query: "SELECT * FROM system.numbers LIMIT 5",
      });

      const responseBody = "foobar";
      await sleep(0);
      request.emit(
        "response",
        buildIncomingMessage({
          body: Zlib.brotliCompressSync(Buffer.from(responseBody)),
          headers: { "content-encoding": "br" },
        }),
      );

      const queryResult = await selectPromise;
      await assertConnQueryResult(queryResult, responseBody);

      expect(httpRequestStub).toHaveBeenCalledTimes(1);
      const calledWith =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
      expect(
        (calledWith.headers as Record<string, string>)["Accept-Encoding"],
      ).toBe("br");
    });
  });

  describe("request compression", () => {
    it("sends a compressed request if compress_request: true", async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: undefined,
          compress_request: { codec: "gzip" },
        },
      });

      const values = "abc".repeat(1_000);

      let chunks = Buffer.alloc(0);
      let finalResult: Buffer | undefined = undefined;
      const request = new Stream.Writable({
        write(chunk, encoding, next) {
          chunks = Buffer.concat([chunks, chunk]);
          next();
        },
        final() {
          Zlib.unzip(chunks, (_err, result) => {
            finalResult = result;
          });
        },
      }) as ClientRequest;
      httpRequestStub.mockReturnValue(request);

      void adapter.insert({
        query: "INSERT INTO insert_compression_table",
        values,
      });

      // trigger stream pipeline
      await sleep(0);
      request.emit("socket", socketStub);
      await sleep(100);

      expect(finalResult!.toString("utf8")).toEqual(values);
      expect(httpRequestStub).toHaveBeenCalledTimes(1);
      const calledWith =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
      expect(
        (calledWith.headers as Record<string, string>)["Content-Encoding"],
      ).toBe("gzip");
    });

    it.skipIf(!zstdSupported)(
      'sends a zstd-compressed request if compress_request: "zstd"',
      async () => {
        const adapter = buildHttpConnection({
          compression: {
            decompress_response: undefined,
            compress_request: { codec: "zstd" },
          },
        });

        const values = "abc".repeat(1_000);

        let chunks = Buffer.alloc(0);
        let resolveResult!: (value: Buffer) => void;
        let rejectResult!: (reason: Error) => void;
        const decompressed = new Promise<Buffer>((resolve, reject) => {
          resolveResult = resolve;
          rejectResult = reject;
        });
        const request = new Stream.Writable({
          write(chunk, encoding, next) {
            chunks = Buffer.concat([chunks, chunk]);
            next();
          },
          final(callback) {
            Zlib.zstdDecompress(chunks, (err, result) => {
              callback(err);
              if (err) {
                rejectResult(err);
              } else {
                resolveResult(result);
              }
            });
          },
        }) as ClientRequest;
        httpRequestStub.mockReturnValue(request);

        void adapter.insert({
          query: "INSERT INTO insert_compression_table",
          values,
        });

        // trigger stream pipeline
        await sleep(0);
        request.emit("socket", socketStub);

        const finalResult = await decompressed;
        expect(finalResult.toString("utf8")).toEqual(values);
        expect(httpRequestStub).toHaveBeenCalledTimes(1);
        const calledWith =
          httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
        expect(
          (calledWith.headers as Record<string, string>)["Content-Encoding"],
        ).toBe("zstd");
      },
    );

    it('sends a br-compressed request if compress_request is { codec: "br" }', async () => {
      const adapter = buildHttpConnection({
        compression: {
          decompress_response: undefined,
          compress_request: { codec: "br" },
        },
      });

      const values = "abc".repeat(1_000);

      let chunks = Buffer.alloc(0);
      let resolveResult!: (value: Buffer) => void;
      let rejectResult!: (reason: Error) => void;
      const decompressed = new Promise<Buffer>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      const request = new Stream.Writable({
        write(chunk, encoding, next) {
          chunks = Buffer.concat([chunks, chunk]);
          next();
        },
        final(callback) {
          Zlib.brotliDecompress(chunks, (err, result) => {
            callback(err);
            if (err) {
              rejectResult(err);
            } else {
              resolveResult(result);
            }
          });
        },
      }) as ClientRequest;
      httpRequestStub.mockReturnValue(request);

      void adapter.insert({
        query: "INSERT INTO insert_compression_table",
        values,
      });

      await sleep(0);
      request.emit("socket", socketStub);

      const finalResult = await decompressed;
      expect(finalResult.toString("utf8")).toEqual(values);
      expect(httpRequestStub).toHaveBeenCalledTimes(1);
      const calledWith =
        httpRequestStub.mock.calls[httpRequestStub.mock.calls.length - 1][1];
      expect(
        (calledWith.headers as Record<string, string>)["Content-Encoding"],
      ).toBe("br");
    });
  });
});

describe("createRequestCompressor", () => {
  async function roundTrip(
    compressor: Stream.Transform,
    decompress: (buf: Buffer) => Buffer,
    input: string,
  ): Promise<string> {
    const chunks: Buffer[] = [];
    compressor.on("data", (chunk: Buffer) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      compressor.on("end", resolve);
      compressor.on("error", reject);
    });
    compressor.end(Buffer.from(input));
    await done;
    return decompress(Buffer.concat(chunks)).toString("utf8");
  }

  it("passes the level to the gzip compressor", () => {
    const createGzip = vi.spyOn(Zlib, "createGzip");
    createRequestCompressor({ codec: "gzip", level: 1 });
    expect(createGzip).toHaveBeenCalledWith({ level: 1 });
  });

  it("uses the codec default when no level is given", () => {
    const createGzip = vi.spyOn(Zlib, "createGzip");
    createRequestCompressor({ codec: "gzip" });
    expect(createGzip).toHaveBeenCalledWith(undefined);
  });

  it("round-trips a gzip body compressed with an explicit level", async () => {
    const values = "abc".repeat(1_000);
    const out = await roundTrip(
      createRequestCompressor({ codec: "gzip", level: 1 }),
      (buf) => Zlib.gunzipSync(buf),
      values,
    );
    expect(out).toBe(values);
  });

  it.skipIf(!zstdSupported)(
    "passes the level to the zstd compressor and round-trips",
    async () => {
      const createZstdCompress = vi.spyOn(Zlib, "createZstdCompress");
      const values = "abc".repeat(1_000);
      const out = await roundTrip(
        createRequestCompressor({ codec: "zstd", level: 19 }),
        (buf) => Zlib.zstdDecompressSync(buf),
        values,
      );
      expect(createZstdCompress).toHaveBeenCalledWith({
        params: { [Zlib.constants.ZSTD_c_compressionLevel]: 19 },
      });
      expect(out).toBe(values);
    },
  );

  it("passes the quality to the brotli compressor (defaulting to 4)", () => {
    const createBrotliCompress = vi.spyOn(Zlib, "createBrotliCompress");
    createRequestCompressor({ codec: "br" });
    expect(createBrotliCompress).toHaveBeenLastCalledWith({
      params: { [Zlib.constants.BROTLI_PARAM_QUALITY]: 4 },
    });
    createRequestCompressor({ codec: "br", quality: 11 });
    expect(createBrotliCompress).toHaveBeenLastCalledWith({
      params: { [Zlib.constants.BROTLI_PARAM_QUALITY]: 11 },
    });
  });

  it("round-trips a br body compressed with an explicit quality", async () => {
    const values = "abc".repeat(1_000);
    const out = await roundTrip(
      createRequestCompressor({ codec: "br", quality: 6 }),
      (buf) => Zlib.brotliDecompressSync(buf),
      values,
    );
    expect(out).toBe(values);
  });
});
