import { classifySetting } from './settings.js'

export interface ParsedArgs {
  host: string
  port: number
  user: string
  password: string
  database: string
  secure: boolean
  query: string | null
  logComment: string | null
  sendLogsLevel: string | null
  maxInsertThreads: string | null
  multiquery: boolean
  help: boolean
  serverSettings: Record<string, string>
  rawArgv: string[]
}

interface OptionSpec {
  long: string
  short?: string
  hasArg: boolean
  // Aliases stored as separate canonical names that resolve to the same value.
  aliases?: string[]
}

const BASE_OPTIONS: readonly OptionSpec[] = [
  { long: 'host', short: 'h', hasArg: true },
  { long: 'port', hasArg: true },
  { long: 'user', short: 'u', hasArg: true },
  { long: 'password', hasArg: true },
  { long: 'database', short: 'd', hasArg: true },
  { long: 'query', short: 'q', hasArg: true },
  { long: 'log_comment', hasArg: true, aliases: ['log-comment'] },
  { long: 'log-comment', hasArg: true },
  { long: 'send_logs_level', hasArg: true, aliases: ['send-logs-level'] },
  { long: 'send-logs-level', hasArg: true },
  { long: 'max_insert_threads', hasArg: true, aliases: ['max-insert-threads'] },
  { long: 'max-insert-threads', hasArg: true },
  { long: 'secure', short: 's', hasArg: false },
  { long: 'multiline', short: 'n', hasArg: false },
  { long: 'multiquery', hasArg: false },
  { long: 'multi-query', hasArg: false },
  { long: 'help', hasArg: false },
]

export const KNOWN_LONG_OPTIONS: ReadonlySet<string> = new Set(
  BASE_OPTIONS.map((o) => o.long),
)

const SHORT_TO_LONG: ReadonlyMap<string, string> = new Map(
  BASE_OPTIONS.filter((o) => o.short !== undefined).map((o) => [
    o.short as string,
    o.long,
  ]),
)

const LONG_HAS_ARG: ReadonlyMap<string, boolean> = new Map(
  BASE_OPTIONS.map((o) => [o.long, o.hasArg]),
)

const USAGE_TEXT = [
  'usage: clickhouse-client [options]',
  '',
  'Known server settings are forwarded to ClickHouse.',
  'Client-only and unknown settings are accepted but not sent to server.',
  'If --query is not specified, the query is read from stdin.',
  '',
  'Options:',
  '  -h, --host HOST              Server host (default: localhost)',
  '      --port PORT              HTTP port (default: 8123)',
  '  -u, --user USER              Username (default: default)',
  '      --password PASSWORD      Password (default: empty)',
  '  -d, --database DB            Database (default: default)',
  '  -q, --query SQL              SQL query to execute',
  '      --log_comment VALUE      Comment for query_log records',
  '      --send_logs_level VALUE  Server log level to send with result',
  '      --max_insert_threads VALUE',
  '                               Max insert threads setting',
  '  -s, --secure                 Use HTTPS',
  '  -n, --multiline              (ignored, accepted for compatibility)',
  '      --multiquery             Execute multiple ";"-separated queries',
  '      --help                   Print this help',
  '',
  'Environment variables:',
  "  CLICKHOUSE_CLIENT_CLI_IMPL   Backend implementation: 'client' (default) or 'http'",
  '  CLICKHOUSE_CLIENT_CLI_LOG    Path to log file for troubleshooting',
  '',
].join('\n')

export function printUsage(
  stream: NodeJS.WritableStream = process.stdout,
): void {
  stream.write(USAGE_TEXT)
}

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    host: 'localhost',
    port: 8123,
    user: 'default',
    password: '',
    database: 'default',
    secure: false,
    query: null,
    logComment: null,
    sendLogsLevel: null,
    maxInsertThreads: null,
    multiquery: false,
    help: false,
    serverSettings: {},
    rawArgv: [...argv],
  }

  // Map of canonical long option -> value (string) or true for flags.
  const seen = new Map<string, string | true>()

  let i = 0
  while (i < argv.length) {
    const arg = argv[i]
    if (arg === undefined) {
      i++
      continue
    }
    if (arg === '--') {
      break
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq >= 0 ? arg.substring(2, eq) : arg.substring(2)
      const inlineValue = eq >= 0 ? arg.substring(eq + 1) : undefined

      if (name.length === 0) {
        i++
        continue
      }

      if (LONG_HAS_ARG.has(name)) {
        const hasArg = LONG_HAS_ARG.get(name) === true
        if (!hasArg) {
          seen.set(name, true)
          i++
          continue
        }
        let value: string
        if (inlineValue !== undefined) {
          value = inlineValue
        } else {
          const next = argv[i + 1]
          if (next === undefined) {
            // Missing required arg: skip silently to mirror lenient behavior.
            i++
            continue
          }
          value = next
          i++
        }
        seen.set(name, value)
        i++
        continue
      }

      // Dynamic / unknown long option. Optional arg.
      let value: string | undefined = inlineValue
      if (value === undefined) {
        const next = argv[i + 1]
        if (next !== undefined) {
          const isNegativeNumber =
            /^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(next)
          const isKnownLongOption = (() => {
            if (!next.startsWith('--')) return false
            const nextEq = next.indexOf('=')
            const nextName =
              nextEq >= 0 ? next.substring(2, nextEq) : next.substring(2)
            return nextName.length > 0 && LONG_HAS_ARG.has(nextName)
          })()

          if (!next.startsWith('-') || isNegativeNumber || !isKnownLongOption) {
            value = next
            i++
          }
        }
      }
      const settingName = name.split('-').join('_')
      if (classifySetting(settingName) === 'server') {
        parsed.serverSettings[settingName] = value ?? '1'
      }
      // CLIENT_ONLY / UNKNOWN: silently dropped.
      i++
      continue
    }

    if (arg.startsWith('-') && arg.length > 1) {
      // Short option (single-char). We do not bundle.
      const shortName = arg.substring(1)
      const longName = SHORT_TO_LONG.get(shortName)
      if (longName === undefined) {
        i++
        continue
      }
      const hasArg = LONG_HAS_ARG.get(longName) === true
      if (!hasArg) {
        seen.set(longName, true)
        i++
        continue
      }
      const next = argv[i + 1]
      if (next === undefined) {
        i++
        continue
      }
      seen.set(longName, next)
      i += 2
      continue
    }

    // Positional argument: ignored.
    i++
  }

  const firstNonNull = (...names: string[]): string | null => {
    for (const n of names) {
      const v = seen.get(n)
      if (typeof v === 'string') {
        return v
      }
    }
    return null
  }

  const hostVal = firstNonNull('host')
  if (hostVal !== null) parsed.host = hostVal
  const portVal = firstNonNull('port')
  if (portVal !== null) {
    const n = Number.parseInt(portVal, 10)
    if (!Number.isNaN(n)) parsed.port = n
  }
  const userVal = firstNonNull('user')
  if (userVal !== null) parsed.user = userVal
  const passwordVal = firstNonNull('password')
  if (passwordVal !== null) parsed.password = passwordVal
  const databaseVal = firstNonNull('database')
  if (databaseVal !== null) parsed.database = databaseVal
  parsed.query = firstNonNull('query')
  parsed.logComment = firstNonNull('log_comment', 'log-comment')
  parsed.sendLogsLevel = firstNonNull('send_logs_level', 'send-logs-level')
  parsed.maxInsertThreads = firstNonNull(
    'max_insert_threads',
    'max-insert-threads',
  )
  parsed.secure = seen.get('secure') === true
  parsed.multiquery =
    seen.get('multiquery') === true || seen.get('multi-query') === true
  parsed.help = seen.get('help') === true

  return parsed
}
