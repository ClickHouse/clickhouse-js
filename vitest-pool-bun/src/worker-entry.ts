/**
 * Worker entry point — this file runs **inside the Bun runtime**.
 *
 * It mirrors Vitest's built-in `workers/forks.ts` wiring, but talks over a
 * JSON-only Node <-> Bun IPC channel (see `channel.ts`). The heavy lifting —
 * driving Vitest's module runner, fetching transformed modules from the Node
 * host over RPC, evaluating them, and running the test callbacks — is done by
 * `runBaseTests`/`setupEnvironment` from `vitest/worker`. Our only job here is
 * to plumb the channel correctly.
 *
 * The Node host launches this via `bun run dist/worker-entry.js` with an IPC
 * file descriptor, so `process.send` / `process.on("message")` are available
 * and behave like Node's `child_process.fork` API.
 */
import { init, runBaseTests, setupEnvironment } from 'vitest/worker'
import { decode, encode } from './channel.js'

if (typeof process.send !== 'function') {
  throw new Error(
    '[vitest-pool-bun]: worker entry expected to be spawned with an IPC channel ' +
      '(stdio "ipc"); process.send is unavailable.',
  )
}

// Capture references in case user code overwrites the globals (matches the
// defensive approach taken by Vitest's own forks worker).
const processExit = process.exit.bind(process)
const processSend = process.send.bind(process)
const processOn = process.on.bind(process)
const processOff = process.off.bind(process)
const processRemoveAllListeners = process.removeAllListeners.bind(process)

function onError(error: unknown): void {
  const code = (error as { code?: string } | undefined)?.code
  // Avoid an infinite loop of "try to report error -> channel is closed -> error".
  if (code === 'ERR_IPC_CHANNEL_CLOSED' || code === 'EPIPE') {
    processExit(1)
  }
}

processOn('error', onError)

init({
  // worker -> host
  post: (response) => processSend(response),
  // host -> worker
  on: (cb) => processOn('message', cb),
  off: (cb) => processOff('message', cb),
  teardown: () => {
    processRemoveAllListeners('message')
    processOff('error', onError)
  },
  // JSON-only channel: encode everything through flatted (see channel.ts).
  serialize: (value) => encode(value),
  deserialize: (value) => decode(value),
  runTests: (state, traces) => runBaseTests('run', state, traces),
  collectTests: (state, traces) => runBaseTests('collect', state, traces),
  setup: setupEnvironment,
})
