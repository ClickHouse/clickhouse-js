/**
 * IPC serialization helpers shared by the host (`pool-worker.ts`) and the Bun
 * worker (`worker-entry.ts`).
 *
 * Why this exists (execution plan §6.2):
 *
 * Node <-> Bun IPC only supports JSON serialization (`serialization: "json"`).
 * Structured-clone ("advanced") serialization, which Vitest's built-in `forks`
 * pool relies on, only works Bun <-> Bun. That means:
 *
 *   - We cannot lean on structured clone to ship rich objects across the channel.
 *   - Node's JSON IPC throws synchronously on circular references, which would
 *     tear the channel down. Vitest's runtime RPC routinely sends object graphs
 *     (task trees, serialized errors) that may contain cycles.
 *
 * `flatted` encodes arbitrary (including circular) object graphs into a plain
 * string. We send that string across the JSON channel, so the only thing the
 * native IPC layer ever has to serialize is a primitive string — always safe.
 *
 * The transform is symmetric and registered on both ends:
 *   - worker `init({ serialize: encode, deserialize: decode })`
 *   - host   `BunPoolWorker.send` calls `encode`, `BunPoolWorker.deserialize`
 *            calls `decode`.
 */
import { parse, stringify } from 'flatted'

/** Encode an outbound message into a JSON-channel-safe string. */
export function encode(value: unknown): string {
  return stringify(value)
}

/**
 * Decode an inbound message produced by {@link encode}.
 *
 * Accepts the raw value delivered by the IPC `message` event. When the channel
 * already handed us the encoded string we parse it; any non-string value is
 * passed through unchanged so the function is safe to call defensively.
 */
export function decode(data: unknown): unknown {
  if (typeof data === 'string') {
    return parse(data)
  }
  return data
}
