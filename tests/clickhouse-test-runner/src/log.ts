import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { EOL } from 'node:os'

const DEFAULT_LOG_PATH = '/tmp/clickhouse-client-cli.log'
const FALLBACK_LOG_FILENAME = 'clickhouse-client-cli.log'

export function resolveLogPath(): string {
  const fromEnv = process.env.CLICKHOUSE_CLIENT_CLI_LOG
  if (fromEnv !== undefined && fromEnv.trim().length > 0) {
    return fromEnv
  }
  return DEFAULT_LOG_PATH
}

function tryAppend(path: string, payload: string): boolean {
  try {
    const parent = dirname(path)
    if (parent.length > 0) {
      mkdirSync(parent, { recursive: true })
    }
    appendFileSync(path, payload, 'utf8')
    return true
  } catch {
    return false
  }
}

export function appendLog(path: string, line: string): void {
  const payload = line + EOL
  if (tryAppend(path, payload)) {
    return
  }
  const fallback = resolve(process.cwd(), FALLBACK_LOG_FILENAME)
  if (fallback !== path) {
    tryAppend(fallback, payload)
  }
}

export function safeForLog(value: string | null | undefined): string {
  return value === null || value === undefined ? '<null>' : value
}
