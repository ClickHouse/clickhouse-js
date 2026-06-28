#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs, printUsage } from "./args.js";
import { appendLog, resolveLogPath, safeForLog } from "./log.js";
import { splitQueries } from "./split-queries.js";
import { buildStatements, type Statement } from "./test-hint.js";
import { handleExtractFromConfig } from "./extract-from-config.js";
import { executeWithClient } from "./backends/client.js";
import { executeWithRowBinary } from "./backends/rowbinary.js";

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "extract-from-config") {
    handleExtractFromConfig(argv.slice(1));
    return;
  }

  const logPath = resolveLogPath();
  appendLog(logPath, "=== clickhouse-client invocation ===");
  appendLog(logPath, "timestamp=" + new Date().toISOString());

  let args;
  try {
    args = parseArgs(argv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write("Error: " + msg + "\n");
    printUsage(process.stderr);
    process.exitCode = 1;
    return;
  }

  if (args.help) {
    printUsage(process.stdout);
    return;
  }

  let query: string | null = args.query;
  if (query === null) {
    try {
      query = readFileSync(0, "utf8");
    } catch {
      query = null;
    }
  }

  if (query === null || query.trim().length === 0) {
    process.stderr.write(
      "No query provided. Use --query or pipe SQL via stdin.\n",
    );
    process.exitCode = 1;
    return;
  }

  const statements: Statement[] = args.multiquery
    ? buildStatements(splitQueries(query))
    : [{ sql: query.trim(), expectedError: null }];
  if (statements.length === 0) {
    // The input contained only comments/whitespace (e.g. a leftover error
    // hint after the final statement). Nothing to run; exit cleanly like the
    // native client would.
    appendLog(logPath, "no_executable_statements=true");
    return;
  }

  appendLog(logPath, "database=" + args.database);
  appendLog(logPath, "user=" + args.user);
  appendLog(logPath, "secure=" + String(args.secure));
  appendLog(logPath, "multiquery=" + String(args.multiquery));
  appendLog(logPath, "log_comment=" + safeForLog(args.logComment));
  appendLog(logPath, "send_logs_level=" + safeForLog(args.sendLogsLevel));
  appendLog(logPath, "max_insert_threads=" + safeForLog(args.maxInsertThreads));
  appendLog(logPath, "server_settings=" + JSON.stringify(args.serverSettings));
  appendLog(logPath, "queries_count=" + String(statements.length));
  for (const stmt of statements) {
    appendLog(logPath, "query=" + stmt.sql);
    if (stmt.expectedError !== null) {
      appendLog(logPath, "expected_error=" + stmt.expectedError.label);
    }
  }

  // Backend selection is via env (the upstream runner controls argv): the
  // RowBinary backend exercises the @clickhouse/rowbinary decode path; the
  // default passthrough backend streams ClickHouse's own TabSeparated text.
  const backend = process.env["TEST_RUNNER_BACKEND"] ?? "passthrough";
  appendLog(logPath, "backend=" + backend);

  try {
    if (backend === "rowbinary") {
      await executeWithRowBinary({ args, statements, logPath });
    } else {
      await executeWithClient({ args, statements, logPath });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    appendLog(logPath, "error=" + msg);
    process.stderr.write("Error: " + msg + "\n");
    process.exitCode = 1;
  }
}

void main();
