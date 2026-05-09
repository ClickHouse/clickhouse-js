import { Buffer } from 'node:buffer'
import type { ParsedArgs } from '../args.js'
import { appendLog } from '../log.js'

export interface BackendOptions {
  args: ParsedArgs
  queries: string[]
  logPath: string
}

function buildUrl(args: ParsedArgs): string {
  const proto = args.secure ? 'https' : 'http'
  const params = new URLSearchParams()
  params.set('database', args.database)
  params.set('default_format', 'TabSeparated')
  if (args.logComment !== null && args.logComment.length > 0) {
    params.set('log_comment', args.logComment)
  }
  if (args.sendLogsLevel !== null && args.sendLogsLevel.length > 0) {
    params.set('send_logs_level', args.sendLogsLevel)
  }
  if (args.maxInsertThreads !== null && args.maxInsertThreads.length > 0) {
    params.set('max_insert_threads', args.maxInsertThreads)
  }
  for (const [k, v] of Object.entries(args.serverSettings)) {
    params.set(k, v)
  }
  return `${proto}://${args.host}:${args.port}/?${params.toString()}`
}

async function writeChunk(chunk: Uint8Array): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const ok = process.stdout.write(chunk, (err) => {
      if (err) reject(err)
      else if (ok) resolve()
    })
    if (!ok) {
      process.stdout.once('drain', () => {
        resolve()
      })
    }
  })
}

export async function executeWithHttp(opts: BackendOptions): Promise<void> {
  const { args, queries, logPath } = opts
  const url = buildUrl(args)
  const auth = Buffer.from(`${args.user}:${args.password}`).toString('base64')
  const headers: Record<string, string> = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'text/plain; charset=utf-8',
  }

  try {
    for (const q of queries) {
      appendLog(logPath, 'executing_query=' + q)
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: q,
      })
      if (!response.ok) {
        const text = await response.text()
        throw new Error(`HTTP ${response.status}: ${text.trim()}`)
      }
      if (response.body === null) continue
      for await (const chunk of response.body) {
        await writeChunk(chunk)
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    appendLog(logPath, 'error=' + msg)
    throw err
  }
}
