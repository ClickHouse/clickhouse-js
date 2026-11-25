import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import Http from "node:http";
import { AddressInfo } from "node:net";
import type Stream from "stream";
import type {
  ClickHouseClient,
  ErrorLogParams,
  Logger,
  LogParams,
} from "@clickhouse/client-common";
import { ClickHouseLogLevel } from "@clickhouse/client-common";
import { createSimpleNodeTestClient } from "../utils/simple_node_client";

// The client must never log the bound query parameter values or the
// credentials. The raw SQL text is logged ONLY when the caller explicitly
// opts in via `dangerously_log_query_text`; it is scrubbed by default.
// The connection layer surfaces request errors via `log_writer.error`, so we
// drive a failing request and inspect the captured log entries.
const SECRET_SQL_MARKER = "topsecret_sql_marker";
const SECRET_PARAM_MARKER = "topsecret_param_marker";
const SECRET_PASSWORD_MARKER = "topsecret_password_marker";

interface CapturedLog {
  message: string;
  args?: Record<string, unknown>;
  err?: Error;
}

const capturedErrors: CapturedLog[] = [];

class CapturingLogger implements Logger {
  trace(_params: LogParams): void {}
  debug(_params: LogParams): void {}
  info(_params: LogParams): void {}
  warn(_params: LogParams): void {}
  error({ message, args, err }: ErrorLogParams): void {
    capturedErrors.push({ message, args, err });
  }
}

describe("[Node.js] query text in logs", () => {
  let server: Http.Server;
  let port: number;

  function makeClient(
    dangerously_log_query_text: boolean,
  ): ClickHouseClient<Stream.Readable> {
    return createSimpleNodeTestClient({
      url: `http://127.0.0.1:${port}`,
      username: "default",
      password: SECRET_PASSWORD_MARKER,
      dangerously_log_query_text,
      log: { LoggerClass: CapturingLogger, level: ClickHouseLogLevel.ERROR },
    }) as unknown as ClickHouseClient<Stream.Readable>;
  }

  beforeAll(async () => {
    // Immediately reset every incoming connection so the outgoing request
    // fails and the connection layer reaches its error-logging branch.
    server = Http.createServer();
    server.on("connection", (socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    port = (server.address() as AddressInfo).port;
  });

  beforeEach(() => {
    capturedErrors.length = 0;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function serializedArgs(): string {
    return JSON.stringify(
      capturedErrors.map(({ message, args }) => ({ message, args })),
    );
  }

  function assertLoggedButNoSecrets(shouldContainSql: boolean) {
    // At least one error must have been logged so the assertions are meaningful.
    expect(capturedErrors.length).toBeGreaterThan(0);
    const serialized = serializedArgs();
    // Param values and credentials are never logged, in either mode.
    expect(serialized).not.toContain(SECRET_PARAM_MARKER);
    expect(serialized).not.toContain(SECRET_PASSWORD_MARKER);
    if (shouldContainSql) {
      expect(serialized).toContain(SECRET_SQL_MARKER);
    } else {
      expect(serialized).not.toContain(SECRET_SQL_MARKER);
    }
    // Sanity check: non-sensitive diagnostics are still logged.
    for (const { args } of capturedErrors) {
      expect(args).toBeDefined();
      expect(args).toHaveProperty("query_id");
      expect(args).toHaveProperty("with_abort_signal");
    }
  }

  describe("with dangerously_log_query_text disabled (default)", () => {
    let client: ClickHouseClient<Stream.Readable>;
    beforeAll(() => {
      client = makeClient(false);
    });
    afterAll(async () => {
      await client.close();
    });

    it("does not log SQL/params/credentials on a failed query", async () => {
      await expect(
        client.query({
          query: `SELECT '${SECRET_SQL_MARKER}', {p:String}`,
          query_params: { p: SECRET_PARAM_MARKER },
        }),
      ).rejects.toThrow();
      assertLoggedButNoSecrets(false);
    });

    it("does not log SQL/params/credentials on a failed insert", async () => {
      await expect(
        client.insert({
          table: SECRET_SQL_MARKER,
          values: [{ id: SECRET_PARAM_MARKER }],
          format: "JSONEachRow",
        }),
      ).rejects.toThrow();
      assertLoggedButNoSecrets(false);
    });

    it("does not log SQL/params/credentials on a failed command", async () => {
      await expect(
        client.command({
          query: `CREATE TABLE ${SECRET_SQL_MARKER} (id String) ENGINE Null`,
        }),
      ).rejects.toThrow();
      assertLoggedButNoSecrets(false);
    });
  });

  describe("with dangerously_log_query_text enabled", () => {
    let client: ClickHouseClient<Stream.Readable>;
    beforeAll(() => {
      client = makeClient(true);
    });
    afterAll(async () => {
      await client.close();
    });

    it("logs the SQL text (but never params/credentials) on a failed query", async () => {
      await expect(
        client.query({
          query: `SELECT '${SECRET_SQL_MARKER}', {p:String}`,
          query_params: { p: SECRET_PARAM_MARKER },
        }),
      ).rejects.toThrow();
      assertLoggedButNoSecrets(true);
    });

    it("logs the SQL text on a failed command", async () => {
      await expect(
        client.command({
          query: `CREATE TABLE ${SECRET_SQL_MARKER} (id String) ENGINE Null`,
        }),
      ).rejects.toThrow();
      assertLoggedButNoSecrets(true);
    });
  });
});
