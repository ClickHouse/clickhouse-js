# Environment

Exact versions used to develop and validate this proof of concept. Other
versions may work but are unverified.

| Component | Version | Role |
| --------- | ------- | ---- |
| Node.js | `v24.16.0` (host requires `>= 20`) | Host / orchestrator: owns the Vite transform pipeline, scheduling, reporters |
| Bun | `1.3.14` (requires `>= 1.2`, `1.3+` preferred) | Worker runtime: evaluates modules and runs the test callbacks |
| vitest | `4.1.8` (requires `^4.1`) | Custom-pool API (`vitest/node`, `vitest/worker`) |
| flatted | `3.4.2` | JSON-safe (circular-ref-tolerant) serialization across the Node ↔ Bun IPC channel |

## Reproducing the version check

```bash
node --version     # v24.16.0
bun --version      # 1.3.14
node -e 'console.log(require("vitest/package.json").version)'   # 4.1.8
```

## Notes

- The **host process is always launched with `node`** (`node node_modules/vitest/vitest.mjs run`). Only the per-file worker is `bun`.
- Package manager: installing with `bun`, `npm`, or `pnpm` is fine; it does not
  affect which runtime executes tests.
- Targets **macOS / Linux only**. Windows is an explicit non-goal for the PoC.
- The `bun` executable must be discoverable. Resolution order:
  `bunBinary` pool option → `BUN_BINARY` env var → `bun` on `PATH`.
