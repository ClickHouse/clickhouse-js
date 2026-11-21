/**
 * Host-side pool worker — runs under **Node** (the Vitest orchestrator process).
 *
 * Responsibilities (execution plan §2 "Host / orchestrator"):
 *   - Spawn one Bun process running `dist/worker-entry.js`.
 *   - Bridge Vitest's `PoolWorker` contract (`send`/`on`/`off`/`start`/`stop`/
 *     `deserialize`) to that Bun child over a JSON-only IPC channel.
 *
 * The implementation deliberately mirrors Vitest's built-in `ForksPoolWorker`
 * (it is the proven Node-host <-> child-runner reference), with three Bun-specific
 * differences:
 *   1. The child is `bun`, not `node`, so we use `child_process.spawn` with an
 *      explicit `ipc` stdio slot instead of `fork`.
 *   2. The IPC channel is forced to `serialization: "json"` because structured
 *      clone is unavailable for Node <-> Bun (plan §6.2).
 *   3. Outbound messages are encoded with flatted inside {@link BunPoolWorker.send}
 *      and inbound messages decoded in {@link BunPoolWorker.deserialize}, because
 *      `PoolWorker` exposes no host-side `serialize` hook.
 */
import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { PoolOptions, PoolWorker, WorkerRequest } from 'vitest/node'
import { decode, encode } from './channel.js'
import type { BunPoolOptions } from './types.js'

/** Grace period before a worker that ignored SIGTERM is force-killed. */
const SIGKILL_TIMEOUT = 1000

/** Number of trailing stderr bytes retained for failure diagnostics. */
const STDERR_TAIL_LIMIT = 8 * 1024

function resolveBunBinary(opts: BunPoolOptions): string {
  return opts.bunBinary ?? process.env.BUN_BINARY ?? 'bun'
}

function resolveWorkerEntry(): string {
  // Resolves to the compiled sibling `dist/worker-entry.js`.
  return fileURLToPath(new URL('./worker-entry.js', import.meta.url))
}

export class BunPoolWorker implements PoolWorker {
  readonly name = 'bun'
  // Vitest may reuse a worker for the next file when `isolate: false`; the
  // runtime caches transformed modules on the host so this stays safe.
  readonly cacheFs = true

  private readonly bunBinary: string
  private readonly workerEntry: string
  private readonly env: NodeJS.ProcessEnv
  private readonly bunArgs: string[]
  private readonly stdout: NodeJS.WritableStream
  private readonly stderr: NodeJS.WritableStream

  private child: ChildProcess | undefined
  /** Rolling tail of the child's stderr, surfaced when the child dies badly. */
  private stderrTail = ''

  constructor(options: PoolOptions, poolOptions: BunPoolOptions) {
    this.bunBinary = resolveBunBinary(poolOptions)
    this.bunArgs = poolOptions.bunArgs ?? []
    this.workerEntry = resolveWorkerEntry()
    this.env = {
      ...options.env,
      ...poolOptions.env,
    } as NodeJS.ProcessEnv
    const logger = options.project.vitest.logger
    this.stdout = logger.outputStream as unknown as NodeJS.WritableStream
    this.stderr = logger.errorStream as unknown as NodeJS.WritableStream
  }

  send(message: WorkerRequest): void {
    this.requireChild().send(encode(message))
  }

  on(event: string, callback: (arg: any) => void): void {
    this.requireChild().on(event, callback)
  }

  off(event: string, callback: (arg: any) => void): void {
    this.requireChild().off(event, callback)
  }

  /** Inbound transform: decode the flatted payload back into an object. */
  deserialize(data: unknown): unknown {
    return decode(data)
  }

  async start(): Promise<void> {
    if (this.child) {
      return
    }
    const child = spawn(this.bunBinary, ['run', ...this.bunArgs, this.workerEntry], {
      env: this.env,
      // ['stdin', 'stdout', 'stderr', 'ipc']. JSON serialization is mandatory
      // for Node <-> Bun IPC; Bun honours NODE_CHANNEL_SERIALIZATION_MODE that
      // Node sets for the child when this option is used.
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      serialization: 'json',
    })
    this.child = child

    if (child.stdout) {
      child.stdout.pipe(this.stdout, { end: false })
    }
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        this.captureStderr(chunk)
      })
      child.stderr.pipe(this.stderr, { end: false })
    }

    // Disambiguate "successfully spawned" from "failed to spawn" (e.g. `bun`
    // not on PATH). Without this, an async ENOENT fires before Vitest attaches
    // its own 'error' listener, and the host hangs until a start timeout.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        child.off('spawn', onSpawn)
        child.off('error', onError)
      }
      const onSpawn = () => {
        cleanup()
        resolve()
      }
      const onError = (error: NodeJS.ErrnoException) => {
        cleanup()
        this.child = undefined
        this.augmentSpawnError(error)
        reject(error)
      }
      child.once('spawn', onSpawn)
      child.once('error', onError)
    })

    // Improve the message of any late, post-spawn process error before Vitest's
    // PoolRunner reports it (it reads `error.message`).
    child.on('error', (error: NodeJS.ErrnoException) => {
      this.augmentSpawnError(error)
    })
  }

  async stop(): Promise<void> {
    const child = this.child
    if (!child) {
      return
    }
    const waitForExit = new Promise<void>((resolve) => {
      if (child.exitCode != null || child.signalCode != null) {
        resolve()
      } else {
        child.once('exit', () => resolve())
      }
    })
    const sigkill = setTimeout(() => child.kill('SIGKILL'), SIGKILL_TIMEOUT)
    child.kill()
    await waitForExit
    clearTimeout(sigkill)
    if (child.stdout) {
      child.stdout.unpipe(this.stdout)
    }
    if (child.stderr) {
      child.stderr.unpipe(this.stderr)
    }
    this.child = undefined
  }

  private captureStderr(chunk: Buffer): void {
    this.stderrTail = (this.stderrTail + chunk.toString('utf-8')).slice(
      -STDERR_TAIL_LIMIT,
    )
  }

  /**
   * Turn an opaque `spawn` failure (most commonly: `bun` not on PATH) into an
   * actionable error before Vitest reports a generic "Worker emitted error".
   */
  private augmentSpawnError(error: NodeJS.ErrnoException): void {
    if (error.code === 'ENOENT') {
      error.message =
        `[vitest-pool-bun]: failed to spawn the Bun runtime ("${this.bunBinary}"). ` +
        'Install Bun (https://bun.sh) and ensure it is on PATH, or set the ' +
        '`bunBinary` pool option / BUN_BINARY environment variable.'
    }
    const tail = this.stderrTail.trim()
    if (tail) {
      error.message += `\nBun worker stderr (last ${STDERR_TAIL_LIMIT} bytes):\n${tail}`
    }
  }

  private requireChild(): ChildProcess {
    if (!this.child) {
      throw new Error(
        '[vitest-pool-bun]: the Bun worker process was torn down or never started.',
      )
    }
    return this.child
  }
}
