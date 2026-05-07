#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { parseArgs, printUsage } from './args.js'
import { appendLog, resolveLogPath, safeForLog } from './log.js'
import { splitQueries } from './split-queries.js'
import { handleExtractFromConfig } from './extract-from-config.js'
import { executeWithClient } from './backends/client.js'
import { executeWithHttp } from './backends/http.js'

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  if (argv[0] === 'extract-from-config') {
    handleExtractFromConfig(argv.slice(1))
    return
  }

  const logPath = resolveLogPath()
  appendLog(logPath, '=== clickhouse-client invocation ===')
  appendLog(logPath, 'timestamp=' + new Date().toISOString())
  appendLog(logPath, 'argv=' + JSON.stringify(argv))

  let args
  try {
    args = parseArgs(argv)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    process.stderr.write('Error: ' + msg + '\n')
    printUsage(process.stderr)
    process.exitCode = 1
    return
  }

  if (args.help) {
    printUsage(process.stdout)
    return
  }

  let query: string | null = args.query
  if (query === null) {
    try {
      query = readFileSync(0, 'utf8')
    } catch {
      query = null
    }
  }

  if (query === null || query.trim().length === 0) {
    process.stderr.write(
      'No query provided. Use --query or pipe SQL via stdin.\n',
    )
    process.exitCode = 1
    return
  }

  const queries = args.multiquery ? splitQueries(query) : [query.trim()]
  if (queries.length === 0) {
    process.stderr.write(
      'No query provided. Use --query or pipe SQL via stdin.\n',
    )
    process.exitCode = 1
    return
  }

  const impl = process.env.CLICKHOUSE_CLIENT_CLI_IMPL ?? 'client'
  if (impl !== 'client' && impl !== 'http') {
    process.stderr.write(
      `Unknown CLICKHOUSE_CLIENT_CLI_IMPL value: ${impl}. Supported: client, http\n`,
    )
    process.exitCode = 1
    return
  }

  appendLog(logPath, 'impl=' + impl)
  appendLog(logPath, 'database=' + args.database)
  appendLog(logPath, 'user=' + args.user)
  appendLog(logPath, 'secure=' + String(args.secure))
  appendLog(logPath, 'multiquery=' + String(args.multiquery))
  appendLog(logPath, 'log_comment=' + safeForLog(args.logComment))
  appendLog(logPath, 'send_logs_level=' + safeForLog(args.sendLogsLevel))
  appendLog(logPath, 'max_insert_threads=' + safeForLog(args.maxInsertThreads))
  appendLog(logPath, 'server_settings=' + JSON.stringify(args.serverSettings))
  appendLog(logPath, 'queries_count=' + String(queries.length))
  for (const q of queries) {
    appendLog(logPath, 'query=' + q)
  }

  try {
    if (impl === 'client') {
      await executeWithClient({ args, queries, logPath })
    } else {
      await executeWithHttp({ args, queries, logPath })
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendLog(logPath, 'error=' + msg)
    process.stderr.write('Error: ' + msg + '\n')
    process.exitCode = 1
  }
}

void main()
