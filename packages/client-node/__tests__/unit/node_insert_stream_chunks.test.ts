import { describe, it, expect } from "vitest";
import net from "node:net";
import Stream from "stream";
import Zlib from "zlib";
import type { ClickHouseClientConfigOptions } from "@clickhouse/client";
import { createSimpleNodeTestClient } from "../utils/simple_node_client";

interface CapturedRequest {
  /** The request line and the headers. */
  head: string;
  /** The size of each HTTP chunk and the time when the chunk arrived.
   *  A body that has a `Content-Length` header is one frame. */
  frames: { size: number; receivedAt: number }[];
  /** The request body without the chunk framing. */
  body: Buffer;
}

interface Sink {
  url: string;
  /** Resolves when the sink has read the complete request body. */
  request: Promise<CapturedRequest>;
  close: () => Promise<void>;
}

/**
 * A TCP server that reads one HTTP request. The body has chunked framing, or
 * it has a `Content-Length` header: Bun does this for a body that the client
 * writes in one piece. `http.createServer()` hides the framing, so the sink
 * parses the bytes.
 */
async function startSink(): Promise<Sink> {
  let onRequest: (request: CapturedRequest) => void = () => {};
  const request = new Promise<CapturedRequest>((resolve) => {
    onRequest = resolve;
  });
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {
      // the client can close the connection when the insert fails
    });

    let received = Buffer.alloc(0);
    let offset = -1; // the start of the next chunk header; -1 until the head is complete
    let head = "";
    let done = false;
    const frames: CapturedRequest["frames"] = [];
    const parts: Buffer[] = [];

    socket.on("data", (data: Buffer) => {
      if (done) {
        return;
      }
      received = Buffer.concat([received, data]);
      if (offset === -1) {
        const headEnd = received.indexOf("\r\n\r\n");
        if (headEnd === -1) {
          return;
        }
        head = received.subarray(0, headEnd).toString();
        offset = headEnd + 4;
      }
      const contentLength = /^content-length:\s*(\d+)/im.exec(head)?.[1];
      if (contentLength !== undefined) {
        const size = Number(contentLength);
        if (received.length < offset + size) {
          return;
        }
        parts.push(received.subarray(offset, offset + size));
        frames.push({ size, receivedAt: performance.now() });
      } else {
        for (;;) {
          const sizeEnd = received.indexOf("\r\n", offset);
          if (sizeEnd === -1) {
            return;
          }
          const size = parseInt(
            received.subarray(offset, sizeEnd).toString(),
            16,
          );
          if (size === 0) {
            break;
          }
          const frameEnd = sizeEnd + 2 + size + 2;
          if (received.length < frameEnd) {
            return;
          }
          parts.push(received.subarray(sizeEnd + 2, sizeEnd + 2 + size));
          frames.push({ size, receivedAt: performance.now() });
          offset = frameEnd;
        }
      }
      done = true;
      onRequest({ head, frames, body: Buffer.concat(parts) });
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    request,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}

/** Inserts the stream into a sink and returns the request that the sink read. */
async function insertIntoSink(
  values: Stream.Readable,
  config: ClickHouseClientConfigOptions = {},
): Promise<CapturedRequest> {
  const sink = await startSink();
  const client = createSimpleNodeTestClient({ url: sink.url, ...config });
  try {
    await client.insert({ table: "t", values, format: "JSONEachRow" });
    return await sink.request;
  } finally {
    await client.close();
    await sink.close();
  }
}

function toRow(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe("[Node.js] insert from an object-mode stream", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => ({ x: i }));
  const payload = rows.map(toRow).join("");

  it(
    "should not send each row as its own HTTP chunk",
    { timeout: 10_000 },
    async () => {
      const request = await insertIntoSink(
        Stream.Readable.from(rows, { objectMode: true }),
      );
      expect(request.body.toString()).toBe(payload);
      expect(request.frames.length).toBeLessThanOrEqual(5);
    },
  );

  it(
    "should send the rows of a slow source before the stream ends",
    { timeout: 10_000 },
    async () => {
      const slowRows = rows.slice(0, 4);
      let next = 0;
      let lastRowAt = Infinity;
      const source = new Stream.Readable({
        objectMode: true,
        read() {
          if (next === slowRows.length) {
            this.push(null);
            return;
          }
          setTimeout(() => {
            const row = slowRows[next++];
            if (next === slowRows.length) {
              lastRowAt = performance.now();
            }
            this.push(row);
          }, 100);
        },
      });
      const request = await insertIntoSink(source);
      expect(request.body.toString()).toBe(slowRows.map(toRow).join(""));
      // The server got the first row while the source was still making rows.
      expect(request.frames[0]?.receivedAt).toBeLessThan(lastRowAt);
    },
  );

  it(
    "should send a valid gzip body when the request compression is on",
    { timeout: 10_000 },
    async () => {
      const request = await insertIntoSink(
        Stream.Readable.from(rows, { objectMode: true }),
        { compression: { request: true } },
      );
      expect(request.head.toLowerCase()).toContain("content-encoding: gzip");
      expect(Zlib.gunzipSync(request.body).toString()).toBe(payload);
    },
  );
});
