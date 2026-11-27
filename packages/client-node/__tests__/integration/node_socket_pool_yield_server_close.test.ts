import { afterEach, describe, it } from "vitest";
import fs from "fs";
import type { ClickHouseClient } from "@clickhouse/client-common";
import { createSimpleTestClient } from "@test/utils/simple_client";
import {
  blockEventLoop,
  startServerInWorker,
  type WorkerServer,
} from "../utils/event_loop";

// `SocketPool.request()` starts with `await sleep(0)`. These tests fail without it.
//
// The server closes each keep-alive socket a short time after its response.
// It runs in a worker thread, so it closes the socket while the main thread is
// blocked and cannot see the close. The 1 ms timer makes the event loop run
// a poll phase before the agent picks a free socket: Node.js then sees the
// close, drops the socket, and the next request opens a new one. Without the
// timer, the next request gets the closed socket and fails with
// "socket hang up" (ECONNRESET).

// The server closes the socket before the client idle_socket_ttl expires,
// so no client timer protects it.
const idleSocketTTL = 2500;
const closeIdleSocketAfterMs = 100;
const blockEventLoopMs = 600;

const serverCode = `
const http = require("http");
const { parentPort } = require("worker_threads");
const closeTimers = new WeakMap();
const server = http.createServer((req, res) => {
  // res.socket is already detached when 'finish' is emitted, so keep a reference.
  const socket = req.socket;
  clearTimeout(closeTimers.get(socket));
  req.resume();
  req.on("end", () => res.end("Ok."));
  res.on("finish", () => {
    closeTimers.set(socket, setTimeout(() => socket.destroy(), ${closeIdleSocketAfterMs}));
  });
});
// The response advertises a long keep-alive; the server closes the socket earlier,
// as a server or a proxy with a shorter idle timeout does.
server.keepAliveTimeout = 60_000;
server.listen(0, "127.0.0.1", () => parentPort.postMessage(server.address().port));
parentPort.on("message", (msg) => {
  if (msg === "close") {
    server.closeAllConnections();
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

describe("[Node.js] SocketPool waits one timer tick before each request: server closes an idle socket", () => {
  let server: WorkerServer | undefined;
  let client: ClickHouseClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    await server?.stop();
    server = undefined;
  });

  async function setup(
    eagerlyDestroyStaleSockets?: boolean,
  ): Promise<ClickHouseClient> {
    server = await startServerInWorker(serverCode);
    client = createSimpleTestClient({
      url: `http://127.0.0.1:${server.port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: idleSocketTTL,
        eagerly_destroy_stale_sockets: eagerlyDestroyStaleSockets,
      },
    });
    await openIdleSocket(client);
    return client;
  }

  // The request opens a socket. The socket goes back to the free pool when
  // the response is read, and the server closes it later.
  async function openIdleSocket(client: ClickHouseClient): Promise<void> {
    await ping(client);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it("sees a server close on an idle socket before it reuses the socket after a blocked event loop", async () => {
    const client = await setup();
    blockEventLoop(blockEventLoopMs);
    // The same macrotask as the block.
    await ping(client);
  });

  it("sees a server close on an idle socket even with eagerly_destroy_stale_sockets, because the socket is younger than idle_socket_ttl", async () => {
    const client = await setup(true);
    blockEventLoop(blockEventLoopMs);
    await ping(client);
  });

  it("sees a server close on an idle socket when the request starts in an I/O callback, where setImmediate would not be enough", async () => {
    // An HTTP server's request handler is such a callback. From the poll phase,
    // a setImmediate callback runs before the next poll phase, so Node.js would
    // still not see the close. The 1 ms timer usually runs after the next poll
    // phase. But when the event loop clock moves to the next millisecond before
    // the next timers phase, the timer is due first, and the request fails
    // (about 1 time in 100). So the test makes up to 3 attempts and needs
    // one success. Without the timer, every attempt fails.
    const client = await setup();
    const errors: unknown[] = [];
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          fs.stat(".", () => {
            blockEventLoop(blockEventLoopMs);
            ping(client).then(resolve, reject);
          });
        });
        return;
      } catch (err) {
        errors.push(err);
        // The failed request destroyed the closed socket. Open a new one.
        await openIdleSocket(client);
      }
    }
    throw new Error(`Every attempt failed: ${errors.map(String).join("; ")}`);
  });
});
