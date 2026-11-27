import { afterEach, describe, expect, it } from "vitest";
import * as http from "http";
import type { AddressInfo } from "net";
import type { ClickHouseClient } from "@clickhouse/client-common";
import { createSimpleTestClient } from "@test/utils/simple_client";
import { blockEventLoop } from "../utils/event_loop";

// `SocketPool.request()` starts with `await sleep(0)`. This test fails without it.
//
// The client destroys a free socket when its idle_socket_ttl timer fires, so
// that it does not reuse a socket that the server is about to close (see
// https://github.com/ClickHouse/clickhouse-js/issues/294). When the event loop
// is blocked for longer than idle_socket_ttl, that timer is overdue. The 1 ms
// timer is due after it, so the overdue timer runs before the agent picks a
// free socket. Without the timer, the next request reuses the socket.
// A setImmediate callback would also run before the next timers phase.
//
// The server never closes the socket here, so the reuse does not fail. The
// test counts the connections instead.

const idleSocketTTL = 100;
const blockEventLoopMs = 600;

describe("[Node.js] SocketPool waits one timer tick before each request: overdue idle socket timer", () => {
  let server: http.Server | undefined;
  let client: ClickHouseClient | undefined;

  afterEach(async () => {
    await client?.close();
    client = undefined;
    if (server) {
      const current = server;
      server = undefined;
      current.closeAllConnections();
      await new Promise<void>((resolve) => current.close(() => resolve()));
    }
  });

  it("lets the overdue idle socket timer destroy a socket before the next request after a blocked event loop", async () => {
    let connections = 0;
    const current = http.createServer((req, res) => {
      req.resume();
      req.on("end", () => res.end("Ok."));
    });
    current.keepAliveTimeout = 60_000;
    current.on("connection", () => connections++);
    server = current;
    const port = await new Promise<number>((resolve) => {
      current.listen(0, "127.0.0.1", () => {
        resolve((current.address() as AddressInfo).port);
      });
    });
    client = createSimpleTestClient({
      url: `http://127.0.0.1:${port}`,
      keep_alive: {
        enabled: true,
        idle_socket_ttl: idleSocketTTL,
      },
    });

    expect((await client.ping()).success).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    blockEventLoop(blockEventLoopMs);
    // The same macrotask as the block. The socket has been idle for longer
    // than idle_socket_ttl, so this request must open a new connection.
    expect((await client.ping()).success).toBe(true);
    expect(connections).toBe(2);
  });
});
