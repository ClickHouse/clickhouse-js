# Validation

What was actually exercised against this PoC, and the boundaries. Versions are
pinned in [`ENVIRONMENT.md`](./ENVIRONMENT.md) (Node 24, Bun 1.3.14,
vitest 4.1.8). Everything below was observed by running the host under `node`
and executing tests in `bun` via this pool.

Legend: ✅ works · ⚠️ works with caveats · ❌ unsupported · ⛔ not attempted (non-goal)

## Core execution

| Capability | Status | Notes |
| ---------- | :----: | ----- |
| Sync tests | ✅ | `examples/tests/smoke.test.ts` |
| Async / `await` tests | ✅ | `examples/tests/async.test.ts`, `concurrent.test.ts` |
| `describe` / nested suites | ✅ | `examples/tests/concurrent.test.ts` |
| Importing local TS modules | ✅ | Resolved + transformed by the host module runner over the channel |
| Importing `node_modules` deps | ✅ | e.g. `vitest` matchers; externalized/transformed via host |
| `setupFiles` | ✅ | `examples/setup.ts` runs in the Bun worker |
| Pass/fail reporting to standard reporters | ✅ | Totals are correct across multiple files |
| Failing-assertion stack traces | ✅ | Point at the original `.ts` source line (host-side Vite source maps); see `npm run demo:failure` |
| Bun globals (`Bun`, `Bun.file`, `Bun.env`, `Bun.version`) | ✅ | `examples/tests/bun-api.test.ts` |

## Isolation & lifecycle

| Capability | Status | Notes |
| ---------- | :----: | ----- |
| Process-per-file isolation (`isolate: true`, default) | ✅ | One spawned `bun` per file; Vitest's scheduler owns this |
| Reused-process mode (`isolate: false`) | ✅ | Correct totals; runner reuse handled by Vitest |
| No leaked Bun processes after a run | ✅ | Verified via `pgrep` after exit, both isolation modes |
| Thread isolation (`worker_threads`) | ❌ | Intentionally not used — Bun threads can't access the parent IPC channel |

## Diagnostics (failure legibility)

| Scenario | Status | Behaviour |
| -------- | :----: | --------- |
| `bun` not found / bad `bunBinary` | ✅ | Fails fast with an actionable message naming `bunBinary` / `BUN_BINARY`; no hang |
| Soft crash (`process.exit` in a test) | ✅ | Reported as a test error with TS-mapped line |
| Hard crash / channel disconnect (worker `SIGKILL`'d mid-run) | ✅ | Surfaced as `[vitest-pool]: Worker bun emitted error. Caused by: Worker exited unexpectedly`; no indefinite hang |

## Test-author features

| Feature | Status | Notes |
| ------- | :----: | ----- |
| Spies (`vi.fn`, `toHaveBeenCalledWith`) | ✅ | Verified |
| Fake timers (`vi.useFakeTimers`, `advanceTimersByTime`) | ✅ | Verified |
| Snapshots (inline & file) | ⚠️ | Mechanism works; not stress-tested for format parity across runtimes (a PoC non-goal) |
| Module mocking (`vi.mock` hoisting) | ⚠️ | Basic factory hoisting verified to work; full `vi.mock` parity is **not** guaranteed and edge cases are untested |

## Coverage

| Provider | Status | Notes |
| -------- | :----: | ----- |
| `istanbul` (`@vitest/coverage-istanbul`) | ✅ | Works — instrumentation happens at transform time on the host, counters are plain JS collected in Bun. Reported 100% on the example source |
| `v8` (`@vitest/coverage-v8`) | ❌ | Fails with `Coverage APIs are not supported` — Bun's `node:inspector` lacks the Profiler/coverage APIs |

## Explicit non-goals (not attempted)

| Area | Status |
| ---- | :----: |
| Watch mode / HMR rerun loop | ⛔ |
| Browser mode | ⛔ |
| Type testing (`expect-type` / `*.test-d.ts`) | ⛔ |
| Windows support | ⛔ |
| Performance / parallelism tuning, worker-reuse pooling | ⛔ |

## Performance note

Independent benchmarks report Bun (JavaScriptCore) can be slower than Node (V8)
on heavily async test workloads. This is a performance characteristic, not a
correctness issue, and was **not** benchmarked here. Treat it as a known caveat
rather than a guarantee in either direction.

## Topology used

The PoC uses the **target topology**: a Node host driving a spawned-process Bun
worker over an IPC channel (not the §7 fallback of running the entire Vitest
process under `bun`). The Phase 0 spike confirmed module evaluation works under
Bun before any pool plumbing was built, so the fallback was never needed.
