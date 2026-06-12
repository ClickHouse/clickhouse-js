// Runs inside the Bun worker before each test file (Vitest `setupFiles`).
// Used by Phase 2 to prove setup files are executed in the Bun runtime.
;(globalThis as Record<string, unknown>).__BUN_POOL_SETUP__ = true
