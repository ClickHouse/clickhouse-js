import { describe, it, beforeEach, afterEach, expect } from "vitest";
import net from "node:net";
import Stream from "node:stream";
import Zlib from "node:zlib";
import { setTimeout as sleep } from "node:timers/promises";
import { isClickHouseVersionAtLeast } from "@test/utils/server_version";
import { isOnEnv, TestEnv } from "@test/utils";
import { ResultSet } from "@clickhouse/client";
import type { ClickHouseClient, Row } from "@clickhouse/client";
import { createNodeTestClient } from "../utils/node_client";

// See https://github.com/ClickHouse/clickhouse-js/issues/1167
//
// The server aborts the connection after a mid-stream error. A consumer that
// is slower than the network must still get every row before the error, then
// the server error.

const errorQuery =
  "SELECT number FROM numbers(200000) WHERE throwIf(number = 100000) = 0";
const errorRowCount = 100000;
const settings = (http_write_exception_in_output_format: 0 | 1) => ({
  // Blocks in order: the server sends the rows 0 to 99999 before the error.
  max_block_size: "1000",
  max_threads: 1,
  output_format_parallel_formatting: 0,
  http_write_exception_in_output_format,
});

type Batches = Stream.Readable & AsyncIterable<Row[]>;
type Reader = (stream: Batches) => Promise<{ rows: number; error: unknown }>;

/** Waits 1 ms for each batch, so the network is faster than the consumer. */
const slowly = () => sleep(1);

const readers: Record<string, Reader> = {
  async "for await"(stream) {
    let rows = 0;
    try {
      for await (const batch of stream) {
        rows += batch.length;
        await slowly();
      }
    } catch (error) {
      return { rows, error };
    }
    return { rows, error: undefined };
  },
  async "'data' with pause()"(stream) {
    let rows = 0;
    const error = await new Promise((resolve) => {
      stream.on("data", (batch: Row[]) => {
        rows += batch.length;
        stream.pause();
        void slowly().then(() => stream.resume());
      });
      stream.on("error", resolve);
      stream.on("end", () => resolve(undefined));
    });
    return { rows, error };
  },
  async "'readable' with read() until null"(stream) {
    let rows = 0;
    let busy = false;
    const error = await new Promise((resolve) => {
      stream.on("readable", async () => {
        if (busy) return;
        busy = true;
        let batch: Row[] | null;
        while ((batch = stream.read()) !== null) {
          rows += batch.length;
          await slowly();
        }
        busy = false;
      });
      stream.on("error", resolve);
      stream.on("end", () => resolve(undefined));
    });
    return { rows, error };
  },
  // Not here: one `read()` for each 'readable' event. Node.js does not emit
  // 'readable' again while the buffer has more batches, also with no error.
  // A unit test covers that reader with one batch before the error.
  async "pipe() to a slow Writable"(stream) {
    let rows = 0;
    const error = await new Promise((resolve) => {
      const writable = new Stream.Writable({
        objectMode: true,
        highWaterMark: 1,
        write(batch: Row[], _encoding, callback) {
          rows += batch.length;
          void slowly().then(() => callback());
        },
      });
      stream.on("error", resolve);
      writable.on("finish", () => resolve(undefined));
      stream.pipe(writable);
    });
    return { rows, error };
  },
};

const serverError = {
  code: "395",
  type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
};

describe("[Node.js] mid-stream errors with a slow consumer", () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createNodeTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  for (const w of [0, 1] as const) {
    describe(`http_write_exception_in_output_format=${w}`, () => {
      for (const [name, read] of Object.entries(readers)) {
        it(`gives every row, then the server error, with ${name}`, async ({
          skip,
        }) => {
          if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
            skip();
          }
          const rs = await client.query({
            query: errorQuery,
            format: "JSONEachRow",
            clickhouse_settings: settings(w),
          });
          const { rows, error } = await read(rs.stream() as Batches);
          expect(error).toMatchObject(serverError);
          expect(rows).toBe(errorRowCount);
        });
      }

      const codecs = ["gzip", "br", "zstd"] as const;
      for (const codec of codecs) {
        it(`gives every row, then the server error, with ${codec} response compression`, async ({
          skip,
        }) => {
          if (
            (codec === "zstd" &&
              typeof Zlib.createZstdDecompress !== "function") ||
            !(await isClickHouseVersionAtLeast(client, 25, 11))
          ) {
            skip();
          }
          const compressedClient = createNodeTestClient({
            compression: { response: { codec } },
          });
          try {
            const rs = await compressedClient.query({
              query: errorQuery,
              format: "JSONEachRow",
              clickhouse_settings: settings(w),
            });
            expect(rs.response_headers["content-encoding"]).toBe(codec);
            const { rows, error } = await readers["for await"](
              rs.stream() as Batches,
            );
            expect(error).toMatchObject(serverError);
            expect(rows).toBe(errorRowCount);
          } finally {
            await compressedClient.close();
          }
        });
      }

      it("rejects json() with the server error", async ({ skip }) => {
        if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
          skip();
        }
        const rs = await client.query({
          query: errorQuery,
          format: "JSONEachRow",
          clickhouse_settings: settings(w),
        });
        await expect(rs.json()).rejects.toMatchObject(serverError);
      });

      it("stops at close() when rows and the server error are pending", async ({
        skip,
      }) => {
        if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
          skip();
        }
        const rs = await client.query({
          query: "SELECT number FROM numbers(10) WHERE throwIf(number = 5) = 0",
          format: "JSONEachRow",
          clickhouse_settings: { ...settings(w), max_block_size: "1" },
        });
        const stream = rs.stream();
        const errors: unknown[] = [];
        stream.on("error", (err) => errors.push(err));
        // The client gets the rows and the error, and nobody reads them.
        await sleep(300);
        rs.close();
        await sleep(50);
        expect(stream.destroyed).toBe(true);
        expect(errors).toEqual([
          expect.objectContaining({ message: "ResultSet has been closed" }),
        ]);
      });
    });
  }

  it("rejects json() after close()", async () => {
    const rs = await client.query({
      query: "SELECT number FROM numbers(10)",
      format: "JSONEachRow",
    });
    rs.close();
    await sleep(0);
    await expect(rs.json()).rejects.toThrow("ResultSet has been closed");
  });

  // ClickHouse writes a newline after the error row. A proxy can cut the
  // response there. Get a real body, and remove the final newline.
  it("detects an error row with no final newline in a real body", async ({
    skip,
  }) => {
    if (!(await isClickHouseVersionAtLeast(client, 25, 11))) {
      skip();
    }
    const result = await client.exec({
      query: `${errorQuery} FORMAT JSONEachRow`,
      clickhouse_settings: settings(1),
    });
    const parts: Buffer[] = [];
    try {
      for await (const part of result.stream) parts.push(part);
    } catch {
      // The server can close the connection after the error row.
    }
    const text = Buffer.concat(parts).toString();
    expect(text.endsWith("}\n")).toBe(true);
    const errorStart = text.lastIndexOf('{"exception": ');
    expect(errorStart).toBeGreaterThan(0);
    const bodies = {
      "rows and the error row": text.slice(0, -1),
      "only the error row": text.slice(errorStart, -1),
    };
    for (const [name, body] of Object.entries(bodies)) {
      const rs = ResultSet.instance({
        stream: Stream.Readable.from([Buffer.from(body)]),
        format: "JSONEachRow",
        query_id: result.query_id,
        log_error: () => {},
        response_headers: result.response_headers,
      });
      const { rows, error } = await readers["for await"](
        rs.stream() as Batches,
      );
      expect({ name, error }).toMatchObject({ name, error: serverError });
      expect({ name, rows }).toEqual({
        name,
        rows: name === "only the error row" ? 0 : errorRowCount,
      });
    }
  });
});

// A proxy gives the first bytes of the response, then closes the connection.
describe.skipIf(!isOnEnv(TestEnv.LocalSingleNode))(
  "[Node.js] network error with a slow consumer",
  () => {
    let proxy: net.Server;
    let port: number;
    let forwarded: Buffer[] = [];
    const bodyLimit = 300_000;

    beforeEach(async () => {
      forwarded = [];
      proxy = net.createServer((downstream) => {
        const upstream = net.connect(8123, "127.0.0.1");
        downstream.pipe(upstream);
        let head = Buffer.alloc(0);
        let headerEnd = -1;
        let bodyBytes = 0;
        upstream.on("data", (data: Buffer) => {
          if (headerEnd === -1) {
            head = Buffer.concat([head, data]);
            headerEnd = head.indexOf("\r\n\r\n");
            if (headerEnd === -1) return;
            downstream.write(head.subarray(0, headerEnd + 4));
            data = head.subarray(headerEnd + 4);
          }
          const part = data.subarray(0, bodyLimit - bodyBytes);
          bodyBytes += part.length;
          forwarded.push(part);
          downstream.write(part);
          if (bodyBytes >= bodyLimit) {
            upstream.destroy();
            downstream.destroy();
          }
        });
        upstream.on("error", () => downstream.destroy());
        downstream.on("error", () => upstream.destroy());
      });
      await new Promise<void>((resolve) => proxy.listen(0, resolve));
      port = (proxy.address() as net.AddressInfo).port;
    });
    afterEach(async () => {
      await new Promise((resolve) => proxy.close(resolve));
    });

    /** The bytes of the chunked body that the proxy gave. */
    function dechunk(body: Buffer): Buffer {
      const parts: Buffer[] = [];
      let i = 0;
      while (i < body.length) {
        const lineEnd = body.indexOf("\r\n", i);
        if (lineEnd === -1) break;
        const size = parseInt(body.subarray(i, lineEnd).toString(), 16);
        if (!(size > 0)) break;
        parts.push(body.subarray(lineEnd + 2, lineEnd + 2 + size));
        i = lineEnd + 2 + size + 2;
      }
      return Buffer.concat(parts);
    }

    for (const compression of [false, true]) {
      it(`gives every row that came before the network error (compression=${compression})`, async () => {
        const client = createNodeTestClient({
          url: `http://127.0.0.1:${port}`,
          compression: { response: compression },
          keep_alive: { enabled: false },
        });
        try {
          const rs = await client.query({
            query: "SELECT number FROM numbers(1000000)",
            format: "JSONEachRow",
          });
          const { rows, error } = await readers["for await"](
            rs.stream() as Batches,
          );
          expect(error).toMatchObject({ code: "ECONNRESET" });

          const body = dechunk(Buffer.concat(forwarded));
          const text = compression
            ? Zlib.gunzipSync(body, {
                finishFlush: Zlib.constants.Z_SYNC_FLUSH,
              }).toString()
            : body.toString();
          const completeRows = text.split("\n").length - 1;
          expect(completeRows).toBeGreaterThan(1000);
          expect(rows).toBe(completeRows);
        } finally {
          await client.close();
        }
      });
    }
  },
);
