import { Cursor, Sink, type Reader, type Writer } from "../src/core.js";

/**
 * Round-trip a server-produced RowBinary payload through the matching reader and
 * writer: decode `bytes` with `read`, re-encode the value with `write`, and
 * assert the writer reproduced the original bytes exactly. This is the writer's
 * core invariant — `write` is the inverse of `read` on canonical ClickHouse
 * output — and the shared shape of every `*.write.test.ts`.
 *
 * Returns the decoded value so a test can additionally assert on it.
 */
export function roundTrip<T>(
  bytes: Buffer,
  read: Reader<T>,
  write: Writer<T>,
): { value: T; encoded: Buffer } {
  const value = read(new Cursor(bytes));
  const sink = new Sink();
  write(sink, value);
  return { value, encoded: Buffer.from(sink.bytes()) };
}
