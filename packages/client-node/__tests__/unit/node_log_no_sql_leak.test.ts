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

// Security regression test: the client must never log the raw SQL statement,
// the bound query parameter values, or the credentials, even on the error path.
// The connection layer surfaces request errors via `log_writer.error`, so we
// drive a failing request and assert the captured log entries are scrubbed.
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

describe("[Node.js] no raw SQL / params / credentials in logs", () => {
  let server: Http.Server;
  let client: ClickHouseClient<Stream.Readable>;

  beforeAll(async () => {
    // Immediately reset every incoming connection so the outgoing request
    // fails and the connection layer reaches its error-logging branch.
    server = Http.createServer();
    server.on("connection", (socket) => socket.destroy());
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const { port } = server.address() as AddressInfo;
    client = createSimpleNodeTestClient({
      url: `http://127.0.0.1:${port}`,
      username: "default",
      password: SECRET_PASSWORD_MARKER,
      log: { LoggerClass: CapturingLogger, level: ClickHouseLogLevel.ERROR },
    }) as unknown as ClickHouseClient<Stream.Readable>;
  });

  beforeEach(() => {
    capturedErrors.length = 0;
  });

  afterAll(async () => {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  });

  function assertNoSecretsLogged() {
    // At least one error must have been logged so the assertion is meaningful.
    expect(capturedErrors.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(
      capturedErrors.map(({ message, args }) => ({ message, args })),
    );
    expect(serialized).not.toContain(SECRET_SQL_MARKER);
    expect(serialized).not.toContain(SECRET_PARAM_MARKER);
    expect(serialized).not.toContain(SECRET_PASSWORD_MARKER);
    // Sanity check: non-sensitive diagnostics are still logged.
    for (const { args } of capturedErrors) {
      expect(args).toBeDefined();
      expect(args).toHaveProperty("query_id");
      expect(args).toHaveProperty("with_abort_signal");
    }
  }

  it("does not leak SQL/params/credentials on a failed query", async () => {
    await expect(
      client.query({
        query: `SELECT '${SECRET_SQL_MARKER}', {p:String}`,
        query_params: { p: SECRET_PARAM_MARKER },
      }),
    ).rejects.toThrow();
    assertNoSecretsLogged();
  });

  it("does not leak SQL/params/credentials on a failed insert", async () => {
    await expect(
      client.insert({
        table: SECRET_SQL_MARKER,
        values: [{ id: SECRET_PARAM_MARKER }],
        format: "JSONEachRow",
      }),
    ).rejects.toThrow();
    assertNoSecretsLogged();
  });

  it("does not leak SQL/params/credentials on a failed command", async () => {
    await expect(
      client.command({
        query: `CREATE TABLE ${SECRET_SQL_MARKER} (id String) ENGINE Null`,
      }),
    ).rejects.toThrow();
    assertNoSecretsLogged();
  });
});
