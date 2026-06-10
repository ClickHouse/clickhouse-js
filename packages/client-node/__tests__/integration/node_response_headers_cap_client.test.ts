import net, { type AddressInfo } from "net";
import { afterEach, describe, it } from "vitest";
import { createClient } from "../../src";
import type { ClickHouseClient } from "@clickhouse/client-common";

// Verifies that the Node.js client honors the `max_response_headers_size`
// configuration option, which is forwarded to `http(s).request` as the
// `maxHeaderSize` option.
//
// Mirrors the scenarios from `node_response_headers_cap.test.ts`, but instead
// of using the raw Node `http` module the request is issued through
// `createClient` + `client.ping()`. A raw TCP server is still used to emit a
// hand-crafted HTTP/1.1 response with a large block of headers, bypassing the
// real ClickHouse server (and its own header-size limits).
describe("[Node.js] client max_response_headers_size behavior", () => {
  let client: ClickHouseClient | undefined;

  afterEach(async () => {
    if (client !== undefined) {
      await client.close();
      client = undefined;
    }
  });

  // Build enough X-H-NNNN headers to roughly reach `targetBytes`.
  function makeHeaders(
    targetBytes: number,
  ): Array<{ name: string; value: string }> {
    const headers: Array<{ name: string; value: string }> = [];
    let total = 0;
    let i = 0;
    while (total < targetBytes) {
      const name = `X-H-${String(i).padStart(4, "0")}`;
      const value = "a".repeat(90);
      headers.push({ name, value });
      total += name.length + 2 /* ": " */ + value.length + 2; /* CRLF */
      i++;
    }
    return headers;
  }

  // Raw TCP server that replies with a fixed HTTP/1.1 response containing
  // the supplied headers. Bypasses Node's own server header limit entirely.
  async function startServer(
    headers: Array<{ name: string; value: string }>,
  ): Promise<[net.Server, number]> {
    const server = net.createServer((socket) => {
      socket.once("data", () => {
        const body = "Ok.\n";
        const headerBlob = headers
          .map((h) => `${h.name}: ${h.value}\r\n`)
          .join("");
        const response =
          "HTTP/1.1 200 OK\r\n" +
          `Content-Length: ${body.length}\r\n` +
          "Connection: close\r\n" +
          headerBlob +
          "\r\n" +
          body;
        socket.write(response);
        socket.end();
      });
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    return [server, (server.address() as AddressInfo).port];
  }

  type ClientResult =
    | { ok: true }
    | { ok: false; code?: string; message: string };

  async function tryClient(
    port: number,
    maxHeaderSize?: number,
  ): Promise<ClientResult> {
    client = createClient({
      url: `http://127.0.0.1:${port}`,
      // Force `Connection: close` so the client does not attempt to reuse
      // sockets across the single response from our raw TCP server.
      keep_alive: { enabled: false },
      max_response_headers_size: maxHeaderSize,
    });
    const result = await client.ping();
    if (result.success) {
      return { ok: true };
    }
    const err = result.error as NodeJS.ErrnoException;
    return { ok: false, code: err.code, message: err.message };
  }

  async function runScenario(params: {
    payloadKB: number;
    maxHeaderSize?: number;
  }): Promise<{ result: ClientResult }> {
    const headers = makeHeaders(params.payloadKB * 1024);
    const [server, port] = await startServer(headers);
    try {
      const result = await tryClient(port, params.maxHeaderSize);
      return { result };
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
  }

  // ── 16K bucket ────────────────────────────────────────────────
  it("A. ~15K payload at default 16K limit fits", async ({ expect }) => {
    const { result } = await runScenario({ payloadKB: 15 });
    expect(result.ok).toBe(true);
  });

  it("B. ~20K payload at default 16K limit overflows (HPE_HEADER_OVERFLOW)", async ({
    expect,
  }) => {
    const { result } = await runScenario({ payloadKB: 20 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HPE_HEADER_OVERFLOW");
  });

  // ── 32K bucket ────────────────────────────────────────────────
  it("C. ~20K payload raised to 32K limit fits", async ({ expect }) => {
    const { result } = await runScenario({
      payloadKB: 20,
      maxHeaderSize: 32 * 1024,
    });
    expect(result.ok).toBe(true);
  });

  it("D. ~40K payload at 32K limit overflows (HPE_HEADER_OVERFLOW)", async ({
    expect,
  }) => {
    const { result } = await runScenario({
      payloadKB: 40,
      maxHeaderSize: 32 * 1024,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("HPE_HEADER_OVERFLOW");
  });

  // ── 64K bucket ────────────────────────────────────────────────
  it("E. ~40K payload raised to 64K limit fits", async ({ expect }) => {
    const { result } = await runScenario({
      payloadKB: 40,
      maxHeaderSize: 64 * 1024,
    });
    expect(result.ok).toBe(true);
  });

  it("F. ~60K payload at 64K limit fits", async ({ expect }) => {
    const { result } = await runScenario({
      payloadKB: 60,
      maxHeaderSize: 64 * 1024,
    });
    expect(result.ok).toBe(true);
  });
});
