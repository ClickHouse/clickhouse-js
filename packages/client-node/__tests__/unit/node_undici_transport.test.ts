import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "http";
import type { AddressInfo } from "net";
import Zlib from "zlib";
import type { ConnectionParams } from "@clickhouse/client-common";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import { createClient } from "../../src";
import {
  NodeConnectionFactory,
  NodeTransportConnection,
} from "../../src/connection";
import { Agent } from "undici";
import type { Logger } from "@clickhouse/client-common";
import { undiciTransport } from "../../src/undici";
import { getAgentOptions } from "../../src/undici/undici_transport";
import type { NodeTransportParams } from "../../src/connection";
import { NodeBaseConnection } from "../../src/connection";

/** A local HTTP server, so that these tests do not need ClickHouse. */
let server: http.Server;
let url: string;
let lastRequest:
  { headers: http.IncomingHttpHeaders; body: Buffer } | undefined;
let handler: (req: http.IncomingMessage, res: http.ServerResponse) => void;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      lastRequest = { headers: req.headers, body: Buffer.concat(chunks) };
      handler(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

function client(config: Parameters<typeof createClient>[0] = {}) {
  return createClient({
    url,
    transport: undiciTransport(),
    compression: { request: false, response: false },
    ...config,
  });
}

// Bun replaces the undici module with a partial implementation without
// `Agent.request()`, so the undici transport is not available there.
const isBun = process.versions["bun"] !== undefined;

describe.skipIf(isBun)("[Node.js] undici transport", () => {
  it("returns the response stream, the headers and the summary", async () => {
    handler = (_req, res) => {
      res.setHeader(
        "X-ClickHouse-Summary",
        JSON.stringify({ read_rows: "42" }),
      );
      res.end("1\n");
    };
    const c = client();
    const rs = await c.query({ query: "SELECT 1", format: "TabSeparated" });
    expect(await rs.text()).toBe("1\n");
    expect(rs.response_headers["x-clickhouse-summary"]).toBeDefined();
    const insert = await c.insert({
      table: "t",
      values: [{ a: 1 }],
      format: "JSONEachRow",
    });
    expect(insert.summary?.read_rows).toBe("42");
    expect(lastRequest?.body.toString()).toBe('{"a":1}\n');
    await c.close();
  });

  it("sends the auth and user agent headers", async () => {
    handler = (_req, res) => res.end();
    const c = client({ username: "u", password: "p", application: "app" });
    await c.command({ query: "SELECT 1" });
    expect(lastRequest?.headers.authorization).toBe(
      `Basic ${Buffer.from("u:p").toString("base64")}`,
    );
    expect(lastRequest?.headers["user-agent"]).toContain("app");
    await c.close();
  });

  it("parses a ClickHouse error response", async () => {
    handler = (_req, res) => {
      res.statusCode = 500;
      res.setHeader("X-ClickHouse-Exception-Code", "62");
      res.end(
        "Code: 62. DB::Exception: Syntax error: failed at position 1. (SYNTAX_ERROR)",
      );
    };
    const c = client();
    await expect(c.query({ query: "SELEC 1" })).rejects.toMatchObject({
      code: "62",
      type: "SYNTAX_ERROR",
    });
    await c.close();
  });

  it("compresses the request body and decompresses the response", async () => {
    handler = (_req, res) => {
      res.setHeader("Content-Encoding", "gzip");
      res.end(Zlib.gzipSync("compressed\n"));
    };
    const c = client({ compression: { request: true, response: true } });
    await c.insert({ table: "t", values: [{ a: 1 }], format: "JSONEachRow" });
    expect(lastRequest?.headers["content-encoding"]).toBe("gzip");
    expect(Zlib.gunzipSync(lastRequest!.body).toString()).toBe('{"a":1}\n');
    const rs = await c.query({ query: "SELECT 1", format: "TabSeparated" });
    expect(await rs.text()).toBe("compressed\n");
    await c.close();
  });

  it("rejects with a plain AbortError when the signal aborts before the request is sent", async () => {
    handler = (_req, res) => res.end();
    const c = client();
    const controller = new AbortController();
    const query = c.query({
      query: "SELECT 1",
      abort_signal: controller.signal,
    });
    controller.abort();
    await expect(query).rejects.toMatchObject({ name: "AbortError" });
    await c.close();
  });

  it("rejects with the abort error when the signal aborts", async () => {
    handler = () => {
      // never responds
    };
    const c = client();
    const controller = new AbortController();
    const query = c.query({
      query: "SELECT 1",
      abort_signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 50);
    await expect(query).rejects.toThrow("The user aborted a request.");
    await c.close();
  });

  it("does not emit an error when the response stream is destroyed before it ends", async () => {
    handler = (_req, res) => {
      // A complete response that the client does not read. When the request
      // is still running, undici adds its own error listener on abort; when it
      // is already complete, it does not, so this is the case to test.
      res.end("1\n");
    };
    const c = client();
    const { stream } = await c.exec({ query: "SELECT 1" });
    const uncaught: unknown[] = [];
    const onUncaught = (err: unknown) => uncaught.push(err);
    // vitest also reports an uncaught error; this makes the assertion explicit
    process.on("uncaughtException", onUncaught);
    try {
      const closed = new Promise((resolve) => stream.once("close", resolve));
      stream.destroy();
      await closed;
      await new Promise((resolve) => setImmediate(resolve));
      expect(uncaught).toEqual([]);
      expect(stream.destroyed).toBe(true);
    } finally {
      process.off("uncaughtException", onUncaught);
    }
    await c.close();
  }, 5_000);

  it("still emits the error of destroy(err)", async () => {
    handler = (_req, res) => {
      res.write("1\n");
    };
    const c = client();
    const { stream } = await c.exec({ query: "SELECT 1" });
    const error = new Error("boom");
    const emitted = new Promise((resolve) => stream.once("error", resolve));
    stream.destroy(error);
    expect(await emitted).toBe(error);
    await c.close();
  });

  it("rejects with the timeout error when the headers do not arrive", async () => {
    handler = () => {
      // never responds
    };
    const c = client({ request_timeout: 100 });
    await expect(c.query({ query: "SELECT 1" })).rejects.toThrow(
      "Timeout error.",
    );
    await c.close();
  });
});

describe.skipIf(isBun)(
  "[Node.js] NodeConnectionFactory with a transport",
  () => {
    const connectionParams = {
      url: new URL("http://localhost"),
      auth: { username: "default", password: "", type: "Credentials" },
      log_writer: new LogWriter(
        new TestLogger(),
        "test",
        ClickHouseLogLevel.OFF,
      ),
      log_level: ClickHouseLogLevel.OFF,
      max_open_connections: 10,
      request_timeout: 1000,
    } as ConnectionParams;
    const common = {
      tls: undefined,
      keep_alive: { enabled: true, idle_socket_ttl: 2500 },
      set_basic_auth_header: true,
      capture_enhanced_stack_trace: false,
    };

    it("creates a transport connection", async () => {
      const connection = NodeConnectionFactory.create({
        ...common,
        connection_params: connectionParams,
        http_agent: undefined,
        transport: undiciTransport(),
      });
      expect(connection).toBeInstanceOf(NodeTransportConnection);
      await connection.close();
    });

    it("does not accept an http_agent together with a transport", () => {
      expect(() =>
        NodeConnectionFactory.create({
          ...common,
          connection_params: connectionParams,
          http_agent: new http.Agent(),
          transport: undiciTransport(),
        }),
      ).toThrow("The http_agent and transport options cannot be used together");
    });
  },
);

describe.skipIf(isBun)("[Node.js] undici transport: error paths", () => {
  it("rejects a response with an unsupported encoding", async () => {
    handler = (_req, res) => {
      res.setHeader("Content-Encoding", "unknown-codec");
      res.end("1\n");
    };
    const c = client();
    await expect(c.query({ query: "SELECT 1" })).rejects.toThrow(
      "Unexpected encoding: unknown-codec",
    );
    await c.close();
  });

  it("logs a summary header that is not valid JSON", async () => {
    handler = (_req, res) => {
      res.setHeader("X-ClickHouse-Summary", "{not json");
      res.end();
    };
    const errors: string[] = [];
    class CollectingLogger implements Logger {
      trace() {}
      debug() {}
      info() {}
      warn() {}
      error({ message }: { message: string }) {
        errors.push(message);
      }
    }
    const c = client({
      log: { LoggerClass: CollectingLogger, level: ClickHouseLogLevel.ERROR },
    });
    const result = await c.command({ query: "SELECT 1" });
    expect(result.summary).toBeUndefined();
    expect(errors).toContain(
      "Command: failed to parse X-ClickHouse-Summary header.",
    );
    await c.close();
  });

  it("throws at client creation when the undici Agent has no request()", () => {
    // This is the case on Bun, which replaces the undici module.
    const descriptor = Object.getOwnPropertyDescriptor(
      Agent.prototype,
      "request",
    );
    Object.defineProperty(Agent.prototype, "request", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    try {
      expect(() => client()).toThrow("does not have Agent.request()");
    } finally {
      if (descriptor) {
        Object.defineProperty(Agent.prototype, "request", descriptor);
      } else {
        delete (Agent.prototype as { request?: unknown }).request;
      }
    }
  });
});

describe("[Node.js] undici transport: Agent options", () => {
  const baseParams = {
    max_open_connections: 10,
    request_timeout: 30_000,
    keep_alive: { enabled: true, idle_socket_ttl: 2500 },
  } as NodeTransportParams;

  it("maps the client configuration", () => {
    expect(getAgentOptions(baseParams)).toEqual({
      connections: 10,
      headersTimeout: 30_000,
      bodyTimeout: 30_000,
      keepAliveTimeout: 2500,
      keepAliveMaxTimeout: 2500,
    });
  });

  it("maps an unlimited number of connections to null", () => {
    expect(
      getAgentOptions({ ...baseParams, max_open_connections: Infinity })
        .connections,
    ).toBeNull();
  });

  it("disables keep-alive with pipelining 0", () => {
    const options = getAgentOptions({
      ...baseParams,
      keep_alive: { enabled: false, idle_socket_ttl: 2500 },
    });
    expect(options.pipelining).toBe(0);
    expect(options.keepAliveTimeout).toBeUndefined();
  });

  it("keeps the undici keep-alive defaults when idle_socket_ttl is 0", () => {
    const options = getAgentOptions({
      ...baseParams,
      keep_alive: { enabled: true, idle_socket_ttl: 0 },
    });
    expect(options.keepAliveTimeout).toBeUndefined();
    expect(options.keepAliveMaxTimeout).toBeUndefined();
  });

  it("sets maxHeaderSize and the TLS options", () => {
    const ca = Buffer.from("ca");
    const cert = Buffer.from("cert");
    const key = Buffer.from("key");
    expect(
      getAgentOptions({
        ...baseParams,
        max_response_headers_size: 65536,
        tls: { type: "Mutual", ca_cert: ca, cert, key },
      }),
    ).toMatchObject({ maxHeaderSize: 65536, connect: { ca, cert, key } });
    expect(
      getAgentOptions({ ...baseParams, tls: { type: "Basic", ca_cert: ca } })
        .connect,
    ).toEqual({ ca });
  });
});

describe("[Node.js] transport connection guards", () => {
  const params = {
    url: new URL("http://localhost"),
    auth: { username: "default", password: "", type: "Credentials" },
    keep_alive: { enabled: true, idle_socket_ttl: 2500 },
  } as NodeTransportParams;

  it("does not accept an unknown protocol with a transport", () => {
    expect(() =>
      NodeConnectionFactory.create({
        connection_params: {
          ...params,
          url: new URL("ftp://localhost"),
        } as ConnectionParams,
        tls: undefined,
        keep_alive: params.keep_alive,
        http_agent: undefined,
        set_basic_auth_header: true,
        capture_enhanced_stack_trace: false,
        transport: undiciTransport(),
      }),
    ).toThrow("Only HTTP and HTTPS protocols are supported");
  });

  it("NodeTransportConnection requires a transport", () => {
    expect(() => new NodeTransportConnection(params)).toThrow(
      "transport is required",
    );
  });

  it("NodeTransportConnection does not create node:http requests", () => {
    const connection = new NodeTransportConnection({
      ...params,
      transport: { name: "stub", create: () => ({}) as never },
    });
    expect(() =>
      (
        connection as unknown as { createClientRequest: () => void }
      ).createClientRequest(),
    ).toThrow("does not create node:http requests");
  });

  it("the base connection requires an agent or a transport", () => {
    class NoAgentConnection extends NodeBaseConnection {
      constructor() {
        super(params, undefined);
      }
      protected createClientRequest(): never {
        throw new Error("not used");
      }
    }
    expect(() => new NoAgentConnection()).toThrow(
      "An HTTP agent or a transport is required",
    );
  });
});
