import { Cursor, Sink } from "./core.js";
import { readInt64 } from "./integers.js";
import { writeInt64 } from "./integers.js";

/** The 11 `Interval` units, in ClickHouse's ascending order. */
export type IntervalUnit =
  | "Nanosecond"
  | "Microsecond"
  | "Millisecond"
  | "Second"
  | "Minute"
  | "Hour"
  | "Day"
  | "Week"
  | "Month"
  | "Quarter"
  | "Year";

/**
 * `Interval` units indexed by the kind byte the binary type encoding writes
 * after the `0x22` tag (`0x00` = Nanosecond ... `0x0a` = Year). Exported because
 * the `Dynamic` reader needs it to decode an `Interval` nested in a `Dynamic`.
 */
export const INTERVAL_UNITS: readonly IntervalUnit[] = [
  "Nanosecond",
  "Microsecond",
  "Millisecond",
  "Second",
  "Minute",
  "Hour",
  "Day",
  "Week",
  "Month",
  "Quarter",
  "Year",
];

/**
 * An `Interval` decoded where the unit is carried IN the wire (inside a
 * `Dynamic`): the signed `Int64` count plus its unit. A standalone `Interval*`
 * column has no unit byte — there, use {@link readInterval} and take the unit
 * from the column type instead.
 */
export type IntervalValue = readonly [count: bigint, unit: IntervalUnit];

/**
 * Read an `Interval` — any of `IntervalNanosecond` ... `IntervalYear`: a signed
 * `Int64` count of the unit. The unit is in the type name, not the bytes, and
 * all 11 interval types share this exact wire, so this one reader covers them
 * all; the caller knows the unit from the column type. Returns a `bigint`; wrap
 * in `Number(...)` if the counts are known to fit in 53 bits.
 */
export function readInterval(state: Cursor): bigint {
  return readInt64(state);
}

/**
 * Write an `Interval` — any of `IntervalNanosecond` ... `IntervalYear`: a signed
 * `Int64` count of the unit. The inverse of {@link readInterval}; the unit lives
 * in the column type, not the bytes, so all 11 interval types share this writer.
 */
export function writeInterval(sink: Sink, value: bigint): void {
  writeInt64(sink, value);
}
