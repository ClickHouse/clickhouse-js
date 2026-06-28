import { Sink } from "./core_writer.js";
import { writeInt64 } from "./integers_writer.js";

/**
 * Write an `Interval` — any of `IntervalNanosecond` ... `IntervalYear`: a signed
 * `Int64` count of the unit. The inverse of `readInterval`; the unit lives in the
 * column type, not the bytes, so all 11 interval types share this writer.
 */
export function writeInterval(sink: Sink, value: bigint): void {
  writeInt64(sink, value);
}
