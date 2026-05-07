import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  existsSync,
  unlinkSync,
} from 'node:fs'
import { EOL } from 'node:os'
import path from 'node:path'
import { appendLog, safeForLog } from '../src/log.js'

describe('appendLog', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = mkdtempSync(path.join(process.cwd(), '.test-tmp-cli-log-'))
  })

  afterAll(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('appends a line followed by EOL to the given file', () => {
    const file = path.join(tmpDir, 'log.txt')
    appendLog(file, 'hello')
    expect(readFileSync(file, 'utf8')).toBe('hello' + EOL)
  })

  it('does not throw when the path is unwritable', () => {
    const fallback = path.resolve(process.cwd(), 'clickhouse-client-cli.log')
    const fallbackPreExisting = existsSync(fallback)
    expect(() =>
      appendLog('/dev/null/non_writable_xyz/log', 'should-not-throw'),
    ).not.toThrow()
    if (!fallbackPreExisting && existsSync(fallback)) {
      unlinkSync(fallback)
    }
  })
})

describe('safeForLog', () => {
  it('returns <null> for null', () => {
    expect(safeForLog(null)).toBe('<null>')
  })

  it('returns <null> for undefined', () => {
    expect(safeForLog(undefined)).toBe('<null>')
  })

  it('returns the original string otherwise', () => {
    expect(safeForLog('x')).toBe('x')
  })
})
