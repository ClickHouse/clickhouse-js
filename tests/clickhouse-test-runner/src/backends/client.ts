import {
  ClickHouseLogLevel,
  createClient as createNativeClient,
} from "@clickhouse/client-native";
import { appendLog } from "../log.js";
import {
  type BackendOptions,
  buildClickHouseSettings,
  createSessionClient,
  settleExpectedError,
} from "./shared.js";

/**
 * Stream query output to stdout. The HTTP backend receives formatted text
 * from ClickHouse. The native client formats the result from native blocks.
 */
export async function executeWithClient(
  opts: BackendOptions,
  backend: "passthrough" | "native",
): Promise<void> {
  const { args, statements, logPath } = opts;
  const client =
    backend === "native"
      ? createNativeClient({
          url: `${args.secure ? "tcps" : "tcp"}://${args.host}:${args.port}`,
          username: args.user,
          password: args.password,
          database: args.database,
          // Each TCP connection is a session. Reuse it for the full SQL script.
          max_open_connections: 1,
          log: { level: ClickHouseLogLevel.OFF },
        })
      : createSessionClient(args, logPath);
  const clickhouse_settings = buildClickHouseSettings(args);

  try {
    for (const stmt of statements) {
      appendLog(logPath, "executing_query=" + stmt.sql);
      let execError: unknown = null;
      try {
        const result = await client.exec({
          query: stmt.sql,
          clickhouse_settings,
        });
        for await (const chunk of result.stream) {
          process.stdout.write(chunk);
        }
      } catch (err) {
        execError = err;
      }
      settleExpectedError(stmt, execError, logPath);
    }
  } finally {
    await client.close();
  }
}
