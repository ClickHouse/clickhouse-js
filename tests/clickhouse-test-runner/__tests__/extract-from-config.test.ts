import { afterEach, describe, expect, it, vi } from 'vitest'
import { handleExtractFromConfig } from '../src/extract-from-config.js'

describe('handleExtractFromConfig', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function captureStdout(): { writes: string[] } {
    const writes: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation(((
      chunk: string | Uint8Array,
    ): boolean => {
      writes.push(
        typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'),
      )
      return true
    }) as typeof process.stdout.write)
    return { writes }
  }

  it('writes 127.0.0.1\\n for --key listen_host', () => {
    const { writes } = captureStdout()
    handleExtractFromConfig(['--key', 'listen_host'])
    expect(writes.join('')).toBe('127.0.0.1\n')
  })

  it('writes 127.0.0.1\\n for --key=listen_host', () => {
    const { writes } = captureStdout()
    handleExtractFromConfig(['--key=listen_host'])
    expect(writes.join('')).toBe('127.0.0.1\n')
  })

  it('writes nothing for --key foo', () => {
    const { writes } = captureStdout()
    handleExtractFromConfig(['--key', 'foo'])
    expect(writes.join('')).toBe('')
  })

  it('writes nothing for empty args', () => {
    const { writes } = captureStdout()
    handleExtractFromConfig([])
    expect(writes.join('')).toBe('')
  })
})
