import { pipeline } from 'node:stream/promises'
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
  const client = createClient({
    url,
    username: args.user,
    password: args.password,
    database: args.database,
  })

  const clickhouse_settings = buildClickHouseSettings(args)

  try {
    for (const q of queries) {
      appendLog(logPath, 'executing_query=' + q)
      const result = await client.exec({
        query: q,
        clickhouse_settings,
      })
      await pipeline(result.stream, process.stdout, { end: false })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendLog(logPath, 'error=' + msg)
    throw err
  } finally {
    await client.close()
  }
}
