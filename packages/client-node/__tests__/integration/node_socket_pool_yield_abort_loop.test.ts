import { afterEach, describe, expect, it } from "vitest";
import * as http from "http";
import type { AddressInfo } from "net";
import {
  ClickHouseLogLevel,
  type ClickHouseClient,
} from "@clickhouse/client-common";
import { createSimpleTestClient } from "@test/utils/simple_client";

// `SocketPool.request()` starts with `await sleep(0)`. This test fails without it.
//
// A request that the caller aborts right after the call settles without I/O.
// In a loop of such requests, each `await` continues in a microtask. Without
// the 1 ms timer, the loop never gives control back to the event loop, so
// timers and I/O callbacks stop until the loop ends.

describe("[Node.js] SocketPool waits one timer tick before each request: loop of aborted requests", () => {
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

  it("gives control back to the event loop in a loop of requests that are aborted right after the call", async () => {
    const current = http.createServer((_req, res) => res.end("Ok."));
    server = current;
    const port = await new Promise<number>((resolve) => {
      current.listen(0, "127.0.0.1", () => {
        resolve((current.address() as AddressInfo).port);
      });
    });
    client = createSimpleTestClient({
      url: `http://127.0.0.1:${port}`,
      // The client logs each aborted request.
      log: { level: ClickHouseLogLevel.OFF },
    });

    let ticks = 0;
    const interval = setInterval(() => ticks++, 10);
    try {
      const until = Date.now() + 300;
      while (Date.now() < until) {
        const controller = new AbortController();
        const query = client.query({
          query: "SELECT 1",
          abort_signal: controller.signal,
        });
        controller.abort();
        await query.catch(() => undefined);
      }
    } finally {
      clearInterval(interval);
    }
    // About 30 when the loop gives control back to the event loop, 0 when it does not.
    expect(ticks).toBeGreaterThanOrEqual(5);
  });
});
