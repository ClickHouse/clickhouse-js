import { randomUUID } from 'node:crypto'
import { createClient } from '@clickhouse/client'
import type { ParsedArgs } from '../args.js'
import { appendLog } from '../log.js'

export interface BackendOptions {
  args: ParsedArgs
  queries: string[]
  logPath: string
}

function buildClickHouseSettings(
  args: ParsedArgs,
): Record<string, string | number> {
  const settings: Record<string, string | number> = {}
  settings['default_format'] = 'TabSeparated'
  if (args.logComment !== null && args.logComment.length > 0) {
    settings['log_comment'] = args.logComment
  }
  if (args.sendLogsLevel !== null && args.sendLogsLevel.length > 0) {
    settings['send_logs_level'] = args.sendLogsLevel
  }
  if (args.maxInsertThreads !== null && args.maxInsertThreads.length > 0) {
    settings['max_insert_threads'] = args.maxInsertThreads
  }
  for (const [k, v] of Object.entries(args.serverSettings)) {
    settings[k] = v
  }
  return settings
}

export async function executeWithClient(opts: BackendOptions): Promise<void> {
  const { args, queries, logPath } = opts
  const proto = args.secure ? 'https' : 'http'
  const url = `${proto}://${args.host}:${args.port}`
  // Use a dedicated per-invocation session_id so that settings applied via
  // `SET ...` in one statement persist for subsequent statements within the
  // same .sql script. Without a session, every `client.exec(...)` call is an
  // independent HTTP request and `SET` has no effect on later requests, which
  // breaks upstream tests that rely on patterns like
  //   SET allow_deprecated_syntax_for_merge_tree = 1;
  //   CREATE TABLE ... ENGINE = MergeTree(d, k, 8192);
  const sessionId = `clickhouse-js-test-runner-${randomUUID()}`
  appendLog(logPath, 'session_id=' + sessionId)
  const client = createClient({
    url,
    username: args.user,
    password: args.password,
    database: args.database,
    session_id: sessionId,
  })

  const clickhouse_settings = buildClickHouseSettings(args)

  try {
    for (const q of queries) {
      appendLog(logPath, 'executing_query=' + q)
      const result = await client.exec({
        query: q,
        clickhouse_settings,
      })
      for await (const chunk of result.stream) {
        process.stdout.write(chunk)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendLog(logPath, 'error=' + msg)
    throw err
  } finally {
    await client.close()
  }
}
