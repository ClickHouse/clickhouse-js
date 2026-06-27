import { type Reader, type Writer, Cursor, Sink } from "./core.js";
import { readInt32, readInt64, readUInt16, readUInt32 } from "./integers.js";
import {
  writeInt32,
  writeInt64,
  writeUInt16,
  writeUInt32,
} from "./integers.js";

/**
 * Semantic aliases for `number` that mark the unit of a temporal value in a
 * return type. They are plain `number`s (no runtime brand) — purely to make
 * `[Date, Nanoseconds]` etc. self-documenting at the call site.
 */
export type Milliseconds = number;
export type Microseconds = number;
export type Nanoseconds = number;

/**
 * Read a `Date`: 2-byte `UInt16` count of days since 1970-01-01 (UTC), returned
 * as a JS `Date` at UTC midnight. A ClickHouse `Date` has no time or timezone;
 * `.toISOString().slice(0, 10)` gives "YYYY-MM-DD".
 *
 * SAFE TO TOGGLE: a `Date` is an object allocation per value. On a hot path that
 * only needs the calendar number, read the raw `UInt16` (days) instead.
 */
export function readDate(state: Cursor): Date {
  return new Date(readUInt16(state) * 86_400_000);
}

/**
 * Read a `Date32`: 4-byte signed `Int32` count of days since 1970-01-01 (UTC),
 * returned as a JS `Date` at UTC midnight (pre-1970 dates are negative day
 * counts, which `Date` handles).
 */
export function readDate32(state: Cursor): Date {
  return new Date(readInt32(state) * 86_400_000);
}

/**
 * Read a `DateTime` (and `DateTime(tz)`): 4-byte `UInt32` Unix seconds, returned
 * as a JS `Date` (exact at second resolution). The instant is UTC-based; a
 * column's timezone is display metadata, not in the bytes.
 */
export function readDateTime(state: Cursor): Date {
  return new Date(readUInt32(state) * 1000);
}

/**
 * Read a `DateTime64(P)` (and `DateTime64(P, tz)`): 8-byte signed `Int64` count
 * of `10^-P`-second ticks since the epoch. Curried: `readDateTime64(P)` returns
 * the reader.
 *
 * Returns a pair `[date, nanoseconds]`: `date` is a JS `Date` truncated to whole
 * seconds, and `nanoseconds` is the sub-second remainder in nanoseconds
 * (0..999_999_999). The split keeps full precision a `Date` alone (millisecond
 * resolution) can't hold. `nanoseconds` is always in ns regardless of P. Timezone
 * is metadata.
 *
 * For the typical precisions, prefer the specialized variants
 * {@link readDateTime64P3} (ms — returns a plain `Date`),
 * {@link readDateTime64P6} (µs), and {@link readDateTime64P9} (ns).
 */
export function readDateTime64(precision: number): Reader<[Date, Nanoseconds]> {
  return (state) => {
    const ticks = readInt64(state);
    const scale = 10n ** BigInt(precision);
    let sec = ticks / scale;
    let frac = ticks % scale;
    if (frac < 0n) {
      // Floor toward -inf so the fractional remainder stays in [0, scale).
      frac += scale;
      sec -= 1n;
    }
    return [new Date(Number(sec) * 1000), Number(frac) * 10 ** (9 - precision)];
  };
}

/**
 * Read a `DateTime64(3)` ({@link Milliseconds}) — the most common precision — as
 * a plain JS `Date`. P=3 is exactly a `Date`'s own millisecond resolution, so the
 * instant is represented losslessly with no separate fraction. Specialized
 * variant of {@link readDateTime64} with the scale baked in.
 */
export function readDateTime64P3(state: Cursor): Date {
  return new Date(Number(readInt64(state)));
}

/**
 * Read a `DateTime64(6)` (microseconds) as `[date, microseconds]`: a JS `Date`
 * truncated to whole seconds plus the sub-second remainder in microseconds.
 * Specialized variant of {@link readDateTime64}.
 */
export function readDateTime64P6(state: Cursor): [Date, Microseconds] {
  const ticks = readInt64(state);
  let sec = ticks / 1_000_000n;
  let frac = ticks % 1_000_000n; // microseconds within the second
  if (frac < 0n) {
    frac += 1_000_000n;
    sec -= 1n;
  }
  return [new Date(Number(sec) * 1000), Number(frac)];
}

/**
 * Read a `DateTime64(9)` (nanoseconds) as `[date, nanoseconds]`: a JS `Date`
 * truncated to whole seconds plus the sub-second remainder in nanoseconds.
 * Specialized variant of {@link readDateTime64} with the scale baked in.
 */
export function readDateTime64P9(state: Cursor): [Date, Nanoseconds] {
  const ticks = readInt64(state);
  let sec = ticks / 1_000_000_000n;
  let frac = ticks % 1_000_000_000n; // nanoseconds within the second
  if (frac < 0n) {
    frac += 1_000_000_000n;
    sec -= 1n;
  }
  return [new Date(Number(sec) * 1000), Number(frac)];
}

const MS_PER_DAY = 86_400_000;

/**
 * Write a `Date`: 2-byte `UInt16` count of days since 1970-01-01 (UTC). The
 * inverse of {@link readDate} — the `Date` it produced is at UTC midnight, so
 * `getTime() / 86_400_000` recovers the whole-day count exactly.
 */
export function writeDate(sink: Sink, value: Date): void {
  writeUInt16(sink, Math.round(value.getTime() / MS_PER_DAY));
}

/**
 * Write a `Date32`: 4-byte signed `Int32` count of days since 1970-01-01 (UTC),
 * negative for pre-1970 dates. The inverse of {@link readDate32}.
 */
export function writeDate32(sink: Sink, value: Date): void {
  writeInt32(sink, Math.round(value.getTime() / MS_PER_DAY));
}

/**
 * Write a `DateTime`: 4-byte `UInt32` Unix seconds. The inverse of
 * {@link readDateTime}; the column timezone is metadata, not in the bytes.
 */
export function writeDateTime(sink: Sink, value: Date): void {
  writeUInt32(sink, Math.round(value.getTime() / 1000));
}

/**
 * Write a `DateTime64(P)`: 8-byte signed `Int64` count of `10^-P`-second ticks.
 * Curried: `writeDateTime64(P)` returns the writer. The inverse of
 * {@link readDateTime64}, which returns `[date, nanoseconds]` (date truncated to
 * whole seconds, nanoseconds the sub-second remainder regardless of P). This
 * recombines them: `ticks = seconds * 10^P + nanoseconds / 10^(9 - P)`. The
 * reader floors seconds toward -inf with a non-negative remainder, so this
 * reconstruction is exact for negative instants too.
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
 * {@link readDateTime64P3}. P=3 is a `Date`'s own resolution, so the tick count
 * is exactly `getTime()` in milliseconds.
 */
export function writeDateTime64P3(sink: Sink, value: Date): void {
  writeInt64(sink, BigInt(value.getTime()));
}

/**
 * Write a `DateTime64(6)` (microseconds) from `[date, microseconds]` — the
 * inverse of {@link readDateTime64P6}. `ticks = seconds * 1_000_000 + micros`.
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
 * of {@link readDateTime64P9}. `ticks = seconds * 1_000_000_000 + nanos`.
 */
export function writeDateTime64P9(
  sink: Sink,
  [date, nanoseconds]: [Date, Nanoseconds],
): void {
  const seconds = BigInt(date.getTime()) / 1000n;
  writeInt64(sink, seconds * 1_000_000_000n + BigInt(nanoseconds));
}
