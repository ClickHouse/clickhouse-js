import { randomUUID } from "node:crypto";
import { ClickHouseLogLevel, createClient } from "@clickhouse/client";
import type { ParsedArgs } from "../args.js";
import { appendLog } from "../log.js";
import { errorMatchesExpectation, type Statement } from "../test-hint.js";

export interface BackendOptions {
  args: ParsedArgs;
  statements: Statement[];
  logPath: string;
}

function buildClickHouseSettings(
  args: ParsedArgs,
): Record<string, string | number> {
  const settings: Record<string, string | number> = {};
  settings["default_format"] = "TabSeparated";
  if (args.logComment !== null && args.logComment.length > 0) {
    settings["log_comment"] = args.logComment;
  }
  if (args.sendLogsLevel !== null && args.sendLogsLevel.length > 0) {
    settings["send_logs_level"] = args.sendLogsLevel;
  }
  if (args.maxInsertThreads !== null && args.maxInsertThreads.length > 0) {
    settings["max_insert_threads"] = args.maxInsertThreads;
  }
  for (const [k, v] of Object.entries(args.serverSettings)) {
    settings[k] = v;
  }
  return settings;
}

export async function executeWithClient(opts: BackendOptions): Promise<void> {
  const { args, statements, logPath } = opts;
  const proto = args.secure ? "https" : "http";
  const url = `${proto}://${args.host}:${args.port}`;
  // Use a dedicated per-invocation session_id so that settings applied via
  // `SET ...` in one statement persist for subsequent statements within the
  // same .sql script. Without a session, every `client.exec(...)` call is an
  // independent HTTP request and `SET` has no effect on later requests, which
  // breaks upstream tests that rely on patterns like
  //   SET allow_deprecated_syntax_for_merge_tree = 1;
  //   CREATE TABLE ... ENGINE = MergeTree(d, k, 8192);
  const sessionId = `clickhouse-js-test-runner-${randomUUID()}`;
  appendLog(logPath, "session_id=" + sessionId);
  const client = createClient({
    url,
    username: args.user,
    password: args.password,
    database: args.database,
    session_id: sessionId,
    // The client logs request errors to stderr by default. We surface failures
    // ourselves (and deliberately swallow errors matched by a `-- { serverError
    // ... }` hint), and upstream `clickhouse-test` fails any test that writes to
    // stderr — so keep the client itself silent.
    log: { level: ClickHouseLogLevel.OFF },
  });

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

      const expected = stmt.expectedError;
      if (expected !== null) {
        // The statement is annotated with `-- { serverError ... }`: an error is
        // the success path, and the absence of one is a failure.
        if (execError === null) {
          throw new Error(
            `Expected error (${expected.label}) but the query succeeded: ${stmt.sql}`,
          );
        }
        if (!errorMatchesExpectation(execError, expected)) {
          const actual =
            execError instanceof Error ? execError.message : String(execError);
          throw new Error(
            `Expected error (${expected.label}) but got a different error: ${actual}`,
          );
        }
        appendLog(logPath, "expected_error_matched=" + expected.label);
        continue;
      }

      if (execError !== null) {
        const msg =
          execError instanceof Error ? execError.message : String(execError);
        appendLog(logPath, "error=" + msg);
        throw execError;
      }
    }
  } finally {
    await client.close();
  }
}
