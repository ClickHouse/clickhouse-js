import { appendLog } from "../log.js";
import {
  type BackendOptions,
  buildClickHouseSettings,
  createSessionClient,
  settleExpectedError,
} from "./shared.js";

/**
 * Passthrough backend (the default): stream ClickHouse's own `TabSeparated`
 * output straight to stdout. The client only transports bytes; ClickHouse does
 * all the formatting. This is what `default_format = TabSeparated` (in
 * {@link buildClickHouseSettings}) selects.
 */
export async function executeWithClient(opts: BackendOptions): Promise<void> {
  const { args, statements, logPath } = opts;
  const client = createSessionClient(args, logPath);
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
