import { describe, it, expect, afterEach } from "vitest";
import { createTestClient } from "@test/utils/client";
import * as http from "http";
import { AddressInfo } from "net";
import type { ClickHouseClient } from "@clickhouse/client-common";
import type { ClickHouseClientConfigOptions } from "@clickhouse/client";
import type Stream from "stream";

// The server answers "SELECT <ms>" after <ms> milliseconds, capped at 5 seconds.
describe("[Node.js] Aborting a request queued for a socket", () => {
  let server: http.Server | undefined;
  let client: ClickHouseClient<Stream.Readable> | undefined;

  afterEach(async () => {
    await client?.close();
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
  });

  it("rejects a command whose signal was aborted before the call", async () => {
    let requests = 0;
    const [httpServer, port] = await createHTTPServer((req, res) => {
      requests += 1;
      req.resume();
      req.on("end", () => res.end("Ok."));
    });
    server = httpServer;
    client = createTestClient({ url: `http://127.0.0.1:${port}` });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.command({ query: "SELECT 1", abort_signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(requests).toBe(0);
  });

  it("should not destroy the socket under the next request after the idle TTL", async () => {
    const idleSocketTTL = 300;
    let port: number;
    [server, port] = await createHTTPServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const requested = Number(/SELECT (\d+)/.exec(body)?.[1] ?? 0);
        const delay = requested <= 5000 ? requested : 5000;
        setTimeout(() => {
          res.write("Ok.");
          res.end();
        }, delay);
      });
    });
    client = createTestClient({
      url: `http://127.0.0.1:${port}`,
      max_open_connections: 1,
      keep_alive: { enabled: true, idle_socket_ttl: idleSocketTTL },
    } as ClickHouseClientConfigOptions);

    const command = (query: string, abort_signal?: AbortSignal) =>
      client!.command({ query, abort_signal });

    // The first request holds the only socket, so the next two wait for it.
    const first = command("SELECT 200");
    const controller = new AbortController();
    const aborted = command("SELECT 0", controller.signal).catch((e) => e);
    // The last request runs well past the first one's release + the idle TTL.
    const last = command(`SELECT ${idleSocketTTL * 3}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
    controller.abort();

    const [firstResult, abortedResult, lastResult] = await Promise.allSettled([
      first,
      aborted,
      last,
    ]);
    expect(firstResult.status).toBe("fulfilled");
    expect((abortedResult as PromiseFulfilledResult<Error>).value.message).toBe(
      "The user aborted a request.",
    );
    expect(lastResult).toEqual(
      expect.objectContaining({ status: "fulfilled" }),
    );
  });
});

async function createHTTPServer(
  cb: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<[http.Server, number]> {
  const server = http.createServer(cb);
  await new Promise<void>((resolve) => {
    server.listen(0, () => resolve());
  });
  return [server, (server.address() as AddressInfo).port];
}
