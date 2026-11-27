import { expect, test } from 'vitest'

// Phase 4: confirm Bun-specific globals/APIs are usable from inside tests,
// proving execution really happens in the Bun runtime (not a Node shim).

test('Bun global is present with a version', () => {
  expect(typeof Bun).toBe('object')
  expect(typeof Bun.version).toBe('string')
  expect(Bun.version.length).toBeGreaterThan(0)
})

test('Bun.file can read a file from disk', async () => {
  const contents = await Bun.file(import.meta.filename).text()
  expect(contents).toContain('Bun.file can read a file from disk')
})

test('Bun.env exposes environment variables', () => {
  expect(typeof Bun.env).toBe('object')
})
