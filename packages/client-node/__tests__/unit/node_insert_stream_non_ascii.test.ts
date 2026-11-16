import { describe, it, expect } from "vitest";
import net from "node:net";
import Stream from "stream";
import { createSimpleNodeTestClient } from "../utils/simple_node_client";

interface Sink {
  url: string;
  /** Resolves with the request body without the chunk framing, when the
   *  sink has read the last chunk. */
  body: Promise<string>;
  close: () => Promise<void>;
}

/**
 * A TCP server that reads one HTTP request with a chunked body, and then
 * answers 200 OK. `http.createServer()` is not used, so that the test does
 * not depend on the HTTP code of Node.js on the server side.
 */
async function startSink(): Promise<Sink> {
  let resolveBody: (body: string) => void = () => {};
  const body = new Promise<string>((resolve) => {
    resolveBody = resolve;
  });
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.on("error", () => {
      // the client closes the connection when the insert fails
    });
    let received = Buffer.alloc(0);
    socket.on("data", (data: Buffer) => {
      received = Buffer.concat([received, data]);
      const headEnd = received.indexOf("\r\n\r\n");
      // The last chunk is "0\r\n", then an empty line.
      if (headEnd === -1 || !received.subarray(-7).equals(LAST_CHUNK)) {
        return;
      }
      const parts: Buffer[] = [];
      let offset = headEnd + 4;
      for (;;) {
        const sizeEnd = received.indexOf("\r\n", offset);
        const size = parseInt(
          received.subarray(offset, sizeEnd).toString(),
          16,
        );
        if (size === 0) {
          break;
        }
        parts.push(received.subarray(sizeEnd + 2, sizeEnd + 2 + size));
        offset = sizeEnd + 2 + size + 2;
      }
      resolveBody(Buffer.concat(parts).toString());
      socket.end(
        "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    body,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        server.close(() => resolve());
      }),
  };
}

const LAST_CHUNK = Buffer.from("\r\n0\r\n\r\n");

describe("[Node.js] insert from an object-mode stream with non-ASCII text", () => {
  // With Node.js 24.22.0+ and 26.9.0+ (nodejs/node#66781), an
  // http.ClientRequest that gets many small non-ASCII strings stops after
  // about 64 KiB: it waits for a 'drain' event that does not come. The client
  // must write Buffers to the request.
  it.each([
    ["two-byte characters", "ééééé"],
    ["CJK characters and an emoji", "日本語テキスト😀"],
  ])("should send all rows with %s", { timeout: 15_000 }, async (_, text) => {
    const rows = Array.from({ length: 10_000 }, (_, i) => ({
      id: i,
      name: `${text}-${i}`,
    }));
    const sink = await startSink();
    const client = createSimpleNodeTestClient({
      url: sink.url,
      request_timeout: 5_000,
    });
    try {
      await client.insert({
        table: "t",
        values: Stream.Readable.from(rows),
        format: "JSONEachRow",
      });
      expect(await sink.body).toBe(
        rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
      );
    } finally {
      await client.close();
      await sink.close();
    }
  });
});
