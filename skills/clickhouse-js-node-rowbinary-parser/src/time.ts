import { type Reader, type Writer, Cursor, Sink } from "./core.js";
import { readInt32, readInt64 } from "./integers.js";
import { writeInt32, writeInt64 } from "./integers.js";

/** Semantic alias for `number` marking a seconds value (see {@link readTime}). */
export type Seconds = number;

/**
 * A signed sub-second duration kept lossless as its raw parts: the value is
 * `ticks / 10 ** precision` seconds. Used by `Time64` (a time-of-day duration,
 * which has no natural JS type), carrying the precision so nothing is lost.
 */
export type ScaledTicks = readonly [ticks: bigint, precision: number];

/**
 * Read a `Time`: 4-byte signed `Int32` seconds-of-day (range ±999:59:59).
 * Returns the raw seconds; pass it to {@link formatTime}.
 */
export function readTime(state: Cursor): Seconds {
  return readInt32(state);
}

/**
 * Read a `Time64(P)`: 8-byte signed `Int64` count of `10^-P`-second ticks.
 * Curried: `readTime64(P)` returns the reader. Returns `[ticks, precision]` (a
 * {@link ScaledTicks}); pass it to {@link formatTime64}.
 */
export function readTime64(precision: number): Reader<ScaledTicks> {
  return (state) => [readInt64(state), precision];
}

/**
 * Format a `Time` value (signed seconds-of-day) as "[-]HH:MM:SS". The hour
 * field can exceed two digits (the range is ±999:59:59).
 */
export function formatTime(seconds: Seconds): string {
  const sign = seconds < 0 ? "-" : "";
  const s = Math.abs(seconds);
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return `${sign}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

/**
 * Format a `Time64` [ticks, precision] (signed sub-second time-of-day) as
 * "[-]HH:MM:SS[.fff]".
 */
export function formatTime64([ticks, precision]: ScaledTicks): string {
  const sign = ticks < 0n ? "-" : "";
  const t = ticks < 0n ? -ticks : ticks;
  const scale = 10n ** BigInt(precision);
  const totalSec = Number(t / scale);
  const frac = t % scale;
  const hh = Math.floor(totalSec / 3600);
  const mm = Math.floor((totalSec % 3600) / 60);
  const ss = totalSec % 60;
  const base = `${sign}${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  return precision > 0
    ? `${base}.${frac.toString().padStart(precision, "0")}`
    : base;
}

/**
 * Write a `Time`: 4-byte signed `Int32` seconds-of-day. The inverse of
 * {@link readTime}; pair with {@link parseTime} to start from an "[-]HH:MM:SS"
 * string.
 */
export function writeTime(sink: Sink, value: Seconds): void {
  writeInt32(sink, value);
}

/**
 * Write a `Time64(P)`: 8-byte signed `Int64` count of `10^-P`-second ticks, from
 * a {@link ScaledTicks} `[ticks, precision]`. The inverse of {@link readTime64};
 * the precision lives in the type, so only `ticks` is written. Pair with
 * {@link parseTime64} to start from a string.
 */
export const writeTime64: Writer<ScaledTicks> = (sink, [ticks]) =>
  writeInt64(sink, ticks);

/**
 * Parse an "[-]HH:MM:SS" string into signed seconds-of-day — the inverse of
 * {@link formatTime}. The hour field may exceed two digits (range ±999:59:59).
 */
export function parseTime(text: string): Seconds {
  const neg = text.startsWith("-");
  const body = neg ? text.slice(1) : text;
  const [hh, mm, ss] = body.split(":");
  const seconds = Number(hh) * 3600 + Number(mm) * 60 + Number(ss);
  return neg ? -seconds : seconds;
}

/**
 * Parse an "[-]HH:MM:SS[.fff]" string into a {@link ScaledTicks} at the given
 * `precision` — the inverse of {@link formatTime64}. A shorter fraction is
 * right-padded with zeros to `precision`; a longer one is truncated.
 */
export function parseTime64(text: string, precision: number): ScaledTicks {
  const neg = text.startsWith("-");
  const body = neg ? text.slice(1) : text;
  const dot = body.indexOf(".");
  const timePart = dot < 0 ? body : body.slice(0, dot);
  const fracPart = dot < 0 ? "" : body.slice(dot + 1);
  const [hh, mm, ss] = timePart.split(":");
  const scale = 10n ** BigInt(precision);
  const wholeSeconds =
    BigInt(Number(hh) * 3600 + Number(mm) * 60 + Number(ss)) * scale;
  const frac = BigInt((fracPart + "0".repeat(precision)).slice(0, precision) || "0");
  const ticks = wholeSeconds + frac;
  return [neg ? -ticks : ticks, precision];
}
