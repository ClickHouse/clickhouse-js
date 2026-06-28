import { type Writer, Sink } from "./core_writer.js";
import { type Microseconds, type Nanoseconds } from "./datetime.js";
import {
  writeInt32,
  writeInt64,
  writeUInt16,
  writeUInt32,
} from "./integers_writer.js";

const MS_PER_DAY = 86_400_000;

/**
 * Write a `Date`: 2-byte `UInt16` count of days since 1970-01-01 (UTC). The
 * inverse of `readDate` — the `Date` it produced is at UTC midnight, so
 * `getTime() / 86_400_000` recovers the whole-day count exactly.
 */
export function writeDate(sink: Sink, value: Date): void {
  writeUInt16(sink, Math.round(value.getTime() / MS_PER_DAY));
}

/**
 * Write a `Date32`: 4-byte signed `Int32` count of days since 1970-01-01 (UTC),
 * negative for pre-1970 dates. The inverse of `readDate32`.
 */
export function writeDate32(sink: Sink, value: Date): void {
  writeInt32(sink, Math.round(value.getTime() / MS_PER_DAY));
}

/**
 * Write a `DateTime`: 4-byte `UInt32` Unix seconds. The inverse of `readDateTime`;
 * the column timezone is metadata, not in the bytes.
 */
export function writeDateTime(sink: Sink, value: Date): void {
  writeUInt32(sink, Math.round(value.getTime() / 1000));
}

/**
 * Write a `DateTime64(P)`: 8-byte signed `Int64` count of `10^-P`-second ticks.
 * Curried: `writeDateTime64(P)` returns the writer. The inverse of
 * `readDateTime64`, which returns `[date, nanoseconds]` (date truncated to whole
 * seconds, nanoseconds the sub-second remainder regardless of P). This recombines
 * them: `ticks = seconds * 10^P + nanoseconds / 10^(9 - P)`. The reader floors
 * seconds toward -inf with a non-negative remainder, so this reconstruction is
 * exact for negative instants too.
 */
export function writeDateTime64(
  precision: number,
): Writer<[Date, Nanoseconds]> {
  const scale = 10n ** BigInt(precision);
  const nsPerTick = 10n ** BigInt(9 - precision);
  return (sink, [date, nanoseconds]) => {
    const seconds = BigInt(date.getTime()) / 1000n;
    writeInt64(sink, seconds * scale + BigInt(nanoseconds) / nsPerTick);
  };
}

/**
 * Write a `DateTime64(3)` (milliseconds) from a plain `Date` — the inverse of
 * `readDateTime64P3`. P=3 is a `Date`'s own resolution, so the tick count is
 * exactly `getTime()` in milliseconds.
 */
export function writeDateTime64P3(sink: Sink, value: Date): void {
  writeInt64(sink, BigInt(value.getTime()));
}

/**
 * Write a `DateTime64(6)` (microseconds) from `[date, microseconds]` — the
 * inverse of `readDateTime64P6`. `ticks = seconds * 1_000_000 + micros`.
 */
export function writeDateTime64P6(
  sink: Sink,
  [date, microseconds]: [Date, Microseconds],
): void {
  const seconds = BigInt(date.getTime()) / 1000n;
  writeInt64(sink, seconds * 1_000_000n + BigInt(microseconds));
}

/**
 * Write a `DateTime64(9)` (nanoseconds) from `[date, nanoseconds]` — the inverse
 * of `readDateTime64P9`. `ticks = seconds * 1_000_000_000 + nanos`.
 */
export function writeDateTime64P9(
  sink: Sink,
  [date, nanoseconds]: [Date, Nanoseconds],
): void {
  const seconds = BigInt(date.getTime()) / 1000n;
  writeInt64(sink, seconds * 1_000_000_000n + BigInt(nanoseconds));
}
