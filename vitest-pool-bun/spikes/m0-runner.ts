/**
 * Phase 0 de-risk spike (THROWAWAY).
 *
 * Purpose: prove, in isolation and before any pool plumbing exists, that the
 * two make-or-break risks are clear under Bun:
 *
 *   §6.1 — Module evaluation. Vitest's plain (non-vm) pool drives Vite's
 *          `ModuleRunner`, which evaluates transformed modules with the
 *          AsyncFunction-based `ESModulesEvaluator` (NOT `node:vm`, whose Bun
 *          conformance is only ~90%). This spike runs that exact evaluator
 *          under Bun against a trivial pre-transformed test module and confirms
 *          the test callback executes and its result round-trips.
 *
 *   §6.3 — `vitest/worker` internals. We import `{ init, runBaseTests,
 *          setupEnvironment }` and confirm they load under Bun (JavaScriptCore)
 *          without tripping over a missing Node internal at import time.
 *
 * No Vite server and no real IPC: module contents are served directly from an
 * in-memory transport, exactly as the plan's Phase 0 task #2 prescribes.
 *
 * Run with:  bun run spikes/m0-runner.ts
 * Expected:  prints a collected + passed result for the trivial test, exit 0.
 */
import { ESModulesEvaluator, ModuleRunner } from 'vite/module-runner'
// Importing these proves the worker helpers load under Bun (risk §6.3).
import { init, runBaseTests, setupEnvironment } from 'vitest/worker'

interface SpikeTest {
  name: string
  fn: () => unknown
}

const ENTRY = '/virtual-spike.test.ts'

// A single trivial pre-transformed module. It has no imports/exports, so the
// module runner only ever asks us for this one module. `test` is provided as a
// global by the harness below, mirroring how a real test framework injects it.
const TRANSFORMED_MODULE = `
test('1 + 1 === 2', () => {
  if (1 + 1 !== 2) {
    throw new Error('arithmetic is broken under Bun');
  }
});
`

async function main(): Promise<void> {
  if (typeof Bun === 'undefined') {
    throw new Error('spike must be executed with `bun`, not node')
  }

  // Sanity-check that the worker helpers are real functions under Bun.
  for (const [name, value] of Object.entries({
    init,
    runBaseTests,
    setupEnvironment,
  })) {
    if (typeof value !== 'function') {
      throw new Error(`vitest/worker export "${name}" did not load under Bun`)
    }
  }

  const collected: SpikeTest[] = []
  ;(globalThis as Record<string, unknown>).test = (
    name: string,
    fn: () => unknown,
  ) => {
    collected.push({ name, fn })
  }

  // The non-vm evaluator Vitest's plain pool relies on.
  const runner = new ModuleRunner(
    {
      transport: {
        async invoke(payload: any) {
          const { name, data } = payload.data
          if (name === 'getBuiltins') {
            return { result: [] }
          }
          if (name === 'fetchModule') {
            const [id] = data as [string]
            if (id.includes('virtual-spike')) {
              return {
                result: {
                  code: TRANSFORMED_MODULE,
                  file: null,
                  id: ENTRY,
                  url: ENTRY,
                  invalidate: false,
                },
              }
            }
            return { error: { message: `unexpected module request: ${id}` } }
          }
          return { error: { message: `unsupported invoke: ${name}` } }
        },
      },
      hmr: false,
      sourcemapInterceptor: false,
    },
    new ESModulesEvaluator(),
  )

  await runner.import(ENTRY)
  console.log(`collected ${collected.length} test(s)`)

  let passed = 0
  let failed = 0
  for (const t of collected) {
    try {
      await t.fn()
      passed += 1
      console.log(`  ✓ ${t.name}`)
    } catch (error) {
      failed += 1
      console.log(`  ✗ ${t.name}: ${(error as Error).message}`)
    }
  }

  console.log(`result: ${passed} passed, ${failed} failed`)
  await runner.close()

  if (failed > 0 || passed === 0) {
    process.exit(1)
  }
  console.log('STOP gate 0: PASSED (test result round-tripped inside Bun)')
}

main().catch((error) => {
  console.error('STOP gate 0: FAILED')
  console.error(error)
  process.exit(1)
})
