# vitest-pool-bun

> **Proof of concept.** A custom [Vitest](https://vitest.dev) 4.1 pool that
> executes test files **inside the [Bun](https://bun.sh) runtime**, analogous to
> how `@cloudflare/vitest-pool-workers` executes them inside `workerd`.

The **Node host** owns the Vite transform pipeline (transforming modules,
scheduling, collecting results, running reporters); **Bun** owns test execution
(evaluating the transformed modules and running the test callbacks). The two
roles talk over a JSON-only IPC channel.

```
┌────────────────────────┐   WorkerRequest / RPC (JSON IPC)   ┌─────────────────────────┐
│  Node host (Vitest)    │  ───────────────────────────────► │  Bun worker             │
│  • Vite transform      │                                    │  • vitest/worker init() │
│  • scheduling          │  ◄─────────────────────────────── │  • module runner        │
│  • reporters           │   WorkerResponse / module code     │  • runs test callbacks  │
└────────────────────────┘                                    └─────────────────────────┘
   src/pool-worker.ts (BunPoolWorker)                            src/worker-entry.ts
```

## Why this works (and what made it non-trivial)

- Bun natively executes TypeScript and imports from disk, so almost none of the
  elaborate module-fallback machinery that the `workerd` pool needs is required.
- Vitest's plain (non-`vm`) pool evaluates modules with Vite's
  AsyncFunction-based `ESModulesEvaluator`, **not** `node:vm`. Bun's `vm` is only
  ~90% conformant, but the AsyncFunction evaluator works cleanly under Bun — this
  is the single most important reason the PoC is viable (de-risked in Phase 0).
- Node ↔ Bun IPC only supports JSON serialization. All channel traffic is routed
  through `flatted` so circular object graphs and Vitest's serialized errors
  survive a JSON-only channel. See [`src/channel.ts`](./src/channel.ts).

## Requirements

See [`ENVIRONMENT.md`](./ENVIRONMENT.md) for pinned versions. In short: Node
`>= 20` (host), Bun `>= 1.2` (worker), `vitest@^4.1`. macOS / Linux only.

## Install

```bash
# from this package directory
npm install
# Bun must be installed and on PATH (https://bun.sh)
bun --version
```

## Configure

Minimal config via the helper:

```ts
// vitest.config.ts
import { defineBunPoolConfig } from 'vitest-pool-bun'

export default defineBunPoolConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
```

Or wire the pool directly:

```ts
import { defineConfig } from 'vitest/config'
import { bunPool } from 'vitest-pool-bun'

export default defineConfig({
  test: {
    pool: bunPool({
      // bunBinary: '/custom/path/to/bun', // defaults to BUN_BINARY env or `bun`
      // bunArgs: ['--smol'],
      // env: { MY_FLAG: '1' },
    }),
  },
})
```

## Run

The host is launched with **node**; the pool spawns **bun** per test file:

```bash
node node_modules/vitest/vitest.mjs run
```

### Demo scripts

| Script | What it shows |
| ------ | ------------- |
| `npm run demo` | Green example suite executed in Bun (9 passing tests) |
| `npm run demo:failure` | A failing assertion reported with a stack trace pointing at the original `.ts` line |
| `npm run demo:diagnostics` | A crashed Bun worker surfaced as a clear host error (not a hang) |
| `npm run spike` | The throwaway Phase 0 de-risk spike (`bun run spikes/m0-runner.ts`) |

`npm run demo` performs a clean `build` first, so a fresh clone only needs
`npm install` followed by `npm run demo`.

## Options (`BunPoolOptions`)

| Option | Type | Default | Description |
| ------ | ---- | ------- | ----------- |
| `bunBinary` | `string` | `BUN_BINARY` env, else `bun` | Path or command for the Bun executable |
| `bunArgs` | `string[]` | `[]` | Extra args passed to `bun run <worker-entry>` |
| `env` | `Record<string, string \| undefined>` | `{}` | Extra env vars for the spawned worker |

## Layout

```
vitest-pool-bun/
├─ src/
│  ├─ index.ts          # bunPool() + defineBunPoolConfig()
│  ├─ pool-worker.ts    # BunPoolWorker (host side, runs under Node)
│  ├─ worker-entry.ts   # runs under Bun; calls init() from 'vitest/worker'
│  ├─ channel.ts        # flatted-based JSON-safe (de)serialization
│  └─ types.ts          # BunPoolOptions
├─ spikes/m0-runner.ts  # Phase 0 de-risk spike (throwaway)
├─ examples/            # runnable example suite + configs
├─ ENVIRONMENT.md       # pinned versions
└─ VALIDATION.md        # what works / partially works / unsupported
```

## Known limitations

This is a proof of concept. See [`VALIDATION.md`](./VALIDATION.md) for the full
matrix. Highlights:

- **V8 coverage is unsupported** under Bun (`node:inspector` lacks the Profiler
  APIs). Use the `istanbul` provider, which works.
- Isolation uses **one Bun process per file** (or a reused process when
  `isolate: false`). Thread isolation is intentionally not used: Bun's
  `worker_threads` cannot access the parent IPC channel.
- No watch/HMR rerun loop, browser mode, type-testing, or Windows support.
- Performance tuning, worker-reuse pooling, and full `vi.mock` parity are out of
  scope for the PoC.

## License

Apache-2.0.
