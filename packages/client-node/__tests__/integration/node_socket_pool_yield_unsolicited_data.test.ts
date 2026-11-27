import { afterEach, describe, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client-common";
import { createSimpleTestClient } from "@test/utils/simple_client";
import {
  blockEventLoop,
  startServerInWorker,
  type WorkerServer,
} from "../utils/event_loop";

// `SocketPool.request()` starts with `await sleep(0)`. These tests fail without it.
//
// The server writes an unsolicited response on a keep-alive socket while the
// socket is idle in the client's free pool. It runs in a worker thread, so it
// writes while the main thread is blocked. Node.js destroys a free socket that
// receives data, but only when a poll phase reads the data. The 1 ms timer
// makes the event loop run a poll phase before the agent picks a free socket.
// Without the timer, the next request gets the socket, and the client reads
// the unsolicited bytes as its response.

const idleSocketTTL = 2500;
const unsolicitedResponseAfterMs = 100;
const blockEventLoopMs = 600;

const serverCode = `
const net = require("net");
const { parentPort } = require("worker_threads");
const sockets = new Set();
const good = "HTTP/1.1 200 OK\\r\\nContent-Length: 3\\r\\nConnection: keep-alive\\r\\nKeep-Alive: timeout=60\\r\\n\\r\\nOk.";
const poisoned = "Code: 999. DB::Exception: unsolicited idle response. (POISON)\\n";
const unsolicited = "HTTP/1.1 503 Service Unavailable\\r\\nContent-Length: " + Buffer.byteLength(poisoned) + "\\r\\nConnection: keep-alive\\r\\nKeep-Alive: timeout=60\\r\\n\\r\\n" + poisoned;
const server = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  let buffered = "";
  let requests = 0;
  socket.on("data", (chunk) => {
    buffered += chunk.toString("latin1");
    let end;
    // The client sends GET requests without a body: one request per header block.
    while ((end = buffered.indexOf("\\r\\n\\r\\n")) !== -1) {
      buffered = buffered.slice(end + 4);
      requests++;
      socket.write(good);
      if (requests === 1) {
        setTimeout(() => {
          if (!socket.destroyed) socket.write(unsolicited);
        }, ${unsolicitedResponseAfterMs});
      }
    }
  });
});
server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));
parentPort.on("message", (msg) => {
  if (msg === "close") {
    for (const socket of sockets) socket.destroy();
    server.close(() => process.exit(0));
  }
});
`;

async function ping(client: ClickHouseClient): Promise<void> {
  const result = await client.ping();
  if (!result.success) {
    throw result.error;
  }
}

describe("[Node.js] SocketPool waits one timer tick before each request: unsolicited data on an idle socket", () => {
  let server: WorkerServer | undefined;
  let client: ClickHouseClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    await server?.stop();
    server = undefined;
  });

  async function run(eagerlyDestroyStaleSockets: boolean): Promise<void> {
    server = await startServerInWorker(serverCode);
    client = createSimpleTestClient({
      url: `http://127.0.0.1:${server.port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: idleSocketTTL,
        eagerly_destroy_stale_sockets: eagerlyDestroyStaleSockets,
      },
    });
    await ping(client);
    await new Promise((resolve) => setTimeout(resolve, 20));
    blockEventLoop(blockEventLoopMs);
    // The same macrotask as the block. Without the timer tick, this request
    // gets "unsolicited idle response" as its result.
    await ping(client);
  }

  it("drops an idle socket that got unsolicited data, so the next request does not read that data as its response", async () => {
    await run(false);
  });

  it("drops an idle socket that got unsolicited data even with eagerly_destroy_stale_sockets, because the socket is younger than idle_socket_ttl", async () => {
    await run(true);
  });
});
