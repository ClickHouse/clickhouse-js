import { BinaryWriter } from "./binary";
import type { ColumnType } from "./types";
import { compareBytes, parseColumnType, quoteName } from "./types";
import { timezoneOffset, wallClockToUTC } from "./text";

/**
 * Encodes JS values as Native columns, for INSERT. Each value goes through
 * two steps:
 *
 * 1. {@link normalize} checks the value against the column type and changes
 *    it to the stored form (for example, a date string to a day number).
 * 2. {@link encodeColumn} writes the stored forms in the Native layout.
 *
 * The accepted values follow the JSON input formats of the server: for
 * example, a 64-bit integer can be a number, a bigint or a string, and a
 * `DateTime` can be a `Date`, UNIX seconds or `YYYY-MM-DD hh:mm:ss` text.
 */

/** A `Variant` value: the index of the variant and the stored value. */
interface VariantNorm {
  d: number;
  v: unknown;
}

/** A `Dynamic` value: the type of the value and the stored value. */
interface DynamicNorm {
  t: ColumnType;
  v: unknown;
}

export class InsertValueError extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, InsertValueError.prototype);
  }
}

/**
 * The server must parse a value using its JSON input rules. The connection
 * sends the rows as JSON text so those rules match the HTTP interface.
 */
export class ServerParseNeeded extends Error {
  constructor(message: string) {
    super(message);
    Object.setPrototypeOf(this, ServerParseNeeded.prototype);
  }
}

function fail(type: ColumnType, value: unknown, reason?: string): never {
  let text: string;
  try {
    text = JSON.stringify(value, (_k, v) =>
      typeof v === "bigint" ? v.toString() : v,
    );
  } catch {
    text = String(value);
  }
  if (text !== undefined && text.length > 100) text = text.slice(0, 100) + "…";
  throw new InsertValueError(
    `Cannot insert the value ${text} into a column of type ${type.name}` +
      (reason ? `: ${reason}` : ""),
  );
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export interface EncodeContext {
  /** The time zone for `DateTime` columns without one. */
  timezone: string;
  /**
   * What to do with `null` for a type that is not `Nullable`. If this is not
   * `false`, the value becomes the default value of the type, as with the
   * server setting `input_format_null_as_default = 1`. If this is `false`,
   * the value is an error.
   * @default true
   */
  null_as_default?: boolean;
  /**
   * The server finds dates in the strings of a `Dynamic` column
   * (`input_format_try_infer_dates`, `input_format_try_infer_datetimes`). If
   * this is `true`, a string that can be a date throws
   * {@link ServerParseNeeded}. If not, each string is a `String`.
   * @default false
   */
  infer_dates?: boolean;
  /** Use the server's JSON parser for values whose handling varies by version. */
  fallback_for_version_specific_values?: boolean;
}

/** The limits of the integer types, by `bits`: `[min signed, max signed,
 *  max unsigned]`. */
const INT_LIMITS: Record<number, [bigint, bigint, bigint]> = {};
/** The same limits as numbers, for the types of 32 bits or less. */
const INT_LIMITS_NUMBER: Record<number, [number, number, number]> = {};
for (const bits of [8, 16, 32, 64, 128, 256]) {
  const limits: [bigint, bigint, bigint] = [
    -(1n << BigInt(bits - 1)),
    (1n << BigInt(bits - 1)) - 1n,
    (1n << BigInt(bits)) - 1n,
  ];
  INT_LIMITS[bits] = limits;
  if (bits <= 32) {
    INT_LIMITS_NUMBER[bits] = [
      Number(limits[0]),
      Number(limits[1]),
      Number(limits[2]),
    ];
  }
}
const INT64_MIN = (INT_LIMITS[64] as [bigint, bigint, bigint])[0];
const INT64_MAX = (INT_LIMITS[64] as [bigint, bigint, bigint])[1];

/** Powers of ten as bigints, by the exponent. */
const POW10_BIG: bigint[] = [];
for (let i = 0; i <= 80; i++) POW10_BIG.push(10n ** BigInt(i));
function pow10(exponent: number): bigint {
  return POW10_BIG[exponent] ?? 10n ** BigInt(exponent);
}
/** Powers of ten as numbers, up to 10^15. */
const POW10_NUMBER: number[] = [];
for (let i = 0; i <= 15; i++) POW10_NUMBER.push(10 ** i);

function toBigInt(type: ColumnType, value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isInteger(value)) fail(type, value, "not an integer");
    return BigInt(value);
  }
  if (typeof value === "boolean") return value ? 1n : 0n;
  if (typeof value === "string") {
    const s = value.trim();
    if (/^[+-]?\d+$/.test(s)) return BigInt(s);
    if (/^[+-]?0x[0-9a-f]+$/i.test(s)) {
      return s.startsWith("-")
        ? -BigInt(s.slice(1))
        : BigInt(s.replace(/^\+/, ""));
    }
  }
  return fail(type, value, "not an integer");
}

function toNumber(type: ColumnType, value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (s === "nan" || s === "+nan" || s === "-nan") return NaN;
    if (s === "inf" || s === "+inf" || s === "infinity") return Infinity;
    if (s === "-inf" || s === "-infinity") return -Infinity;
    const n = Number(s);
    if (s !== "" && !Number.isNaN(n)) return n;
  }
  return fail(type, value, "not a number");
}

/**
 * Reads plain decimal text (`[+-]digits[.digits]`, at most 15 digits) at
 * `scale` without a regular expression and without BigInt arithmetic.
 * Returns `undefined` for other text (the caller then uses the slow path).
 */
function fastScaledDecimal(text: string, scale: number): number | undefined {
  const length = text.length;
  if (length === 0 || length > 17) return undefined;
  let i = 0;
  let negative = false;
  const first = text.charCodeAt(0);
  if (first === 45 || first === 43) {
    negative = first === 45;
    i = 1;
  }
  let mantissa = 0;
  let digits = 0;
  let fractionDigits = -1; // -1: before the decimal point
  for (; i < length; i++) {
    const c = text.charCodeAt(i);
    if (c === 46) {
      if (fractionDigits !== -1) return undefined;
      fractionDigits = 0;
      continue;
    }
    const d = c - 48;
    if (d < 0 || d > 9) return undefined;
    if (fractionDigits !== -1) {
      // Extra fractional digits are cut off.
      if (fractionDigits === scale) continue;
      fractionDigits++;
    }
    mantissa = mantissa * 10 + d;
    digits++;
  }
  if (digits === 0) return undefined;
  const shift = scale - (fractionDigits === -1 ? 0 : fractionDigits);
  if (digits + shift > 15) return undefined;
  const scaled = mantissa * (POW10_NUMBER[shift] as number);
  return negative ? -scaled : scaled;
}

/** A decimal number (number, bigint or text) to its integer at `scale`.
 *  Extra fractional digits are cut off, as the server does. */
export function toScaledDecimal(
  type: ColumnType,
  value: unknown,
  scale: number,
): bigint {
  if (typeof value === "bigint") return value * pow10(scale);
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(type, value);
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return fail(type, value, "not a decimal number");
  }
  const fast = fastScaledDecimal(text, scale);
  if (fast !== undefined) return BigInt(fast);
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (m === null || (m[2] === "" && (m[3] ?? "") === "")) {
    return fail(type, value, "not a decimal number");
  }
  const fraction = m[3] ?? "";
  const exponent = Number(m[4] ?? 0);
  if (Math.abs(exponent) > 1000) fail(type, value, "out of range");
  const digits = BigInt((m[2] ?? "") + fraction || "0");
  const shift = scale + exponent - fraction.length;
  const scaled = shift >= 0 ? digits * pow10(shift) : digits / pow10(-shift);
  return m[1] === "-" ? -scaled : scaled;
}

// ---------------------------------------------------------------------------
// Dates and times
//
// The rules follow the JSON input of a server with the default
// `date_time_input_format = 'best_effort'`: values out of range are changed
// to the nearest limit, and text that the server rejects is an error.
// ---------------------------------------------------------------------------

/** The largest `DateTime`: 2106-02-07 06:28:15 UTC. */
const DATETIME_MAX = 0xffffffff;
/** The largest `Date`: 2149-06-06. */
const DATE_MAX = 0xffff;
/** The limits of `Date32`: 0000-01-01 and 9999-12-31. */
const DATE32_MIN = -719528;
const DATE32_MAX = 2932896;
/** The `Date32` that the server stores for a month or a day that is not
 *  correct: 1900-01-01. For `Date`, it stores 1970-01-01. */
const DATE32_ERROR_DAY = -25567;
/** The server reads a `Date32` number above the day limit as UNIX seconds,
 *  up to this limit. */
const INT32_MAX = 0x7fffffff;
/** The limits of the seconds of a `DateTime64` number: 0000-01-01 00:00:00
 *  and 9999-12-31 23:59:59. */
const DATETIME64_MIN_SECONDS = -62167219200n;
const DATETIME64_MAX_SECONDS = 253402300799n;
/** The largest `Time` and `Time64`: 999:59:59. */
const TIME_MAX_SECONDS = 3599999;

const DATE_TIME_RE =
  /^(\d{4})\D(\d{1,2})\D(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d*))?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i;
const DATE_RE = /^(\d{4})\D(\d{1,2})\D(\d{1,2})$/;
const DIGITS_RE = /^(\d+)(?:\.(\d*))?$/;
const TIME_RE =
  /^(-)?(?:(\d{1,3}):(\d{2}):(\d{2})|(\d{1,2}):(\d{2})|(\d{1,2}))(?:\.(\d*))?$/;

/** `count` decimal digits at `from`, or -1. */
function digitsAt(text: string, from: number, count: number): number {
  let v = 0;
  for (let i = from; i < from + count; i++) {
    const c = text.charCodeAt(i) - 48;
    if (c < 0 || c > 9 || Number.isNaN(c)) return -1;
    v = v * 10 + c;
  }
  return v;
}

/** Days since 1970-01-01 of a date of the proleptic Gregorian calendar
 *  (H. Hinnant's days_from_civil). */
function daysFromCivil(year: number, month: number, day: number): number {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** True if the month has this day. */
function isCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  if (day <= 28) return true;
  if (month === 2 && day === 29) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  }
  return day <= (DAYS_IN_MONTH[month - 1] as number);
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** The day number of UNIX seconds in the time zone. */
function secondsToDays(seconds: number, timezone: string): number {
  return Math.floor((seconds + timezoneOffset(seconds, timezone)) / 86400);
}

/**
 * The stored value of a `Date` (`extended = false`) or a `Date32` column.
 *
 * - A number is a day number. A number above the largest day number is UNIX
 *   seconds, as on the server.
 * - Text is `YYYY-MM-DD` (the month and the day can have one digit) or
 *   `YYYYMMDD`. The server stores a fixed date for a month or a day that is
 *   not correct.
 * - A value out of range becomes the nearest limit.
 */
function toDays(
  type: ColumnType,
  value: unknown,
  extended: boolean,
  timezone: string,
): number {
  const min = extended ? DATE32_MIN : 0;
  const max = extended ? DATE32_MAX : DATE_MAX;
  if (typeof value === "string") {
    let year: number;
    let month: number;
    let day: number;
    if (value.length === 10 && digitsAt(value, 4, 1) === -1) {
      year = digitsAt(value, 0, 4);
      month = digitsAt(value, 5, 2);
      day = digitsAt(value, 8, 2);
      if (digitsAt(value, 7, 1) !== -1) year = -1;
    } else if (value.length === 8) {
      year = digitsAt(value, 0, 4);
      month = digitsAt(value, 4, 2);
      day = digitsAt(value, 6, 2);
    } else {
      year = -1;
      month = -1;
      day = -1;
    }
    if (year === -1 || month === -1 || day === -1) {
      const m = DATE_RE.exec(value);
      if (m === null) return fail(type, value, "not a date");
      year = Number(m[1]);
      month = Number(m[2]);
      day = Number(m[3]);
    }
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return extended ? DATE32_ERROR_DAY : 0;
    }
    return clamp(daysFromCivil(year, month, day), min, max);
  }
  let n: number;
  if (value instanceof Date) {
    n = Math.floor(value.getTime() / 86_400_000);
    if (Number.isNaN(n)) return fail(type, value, "not a date");
    return clamp(n, min, max);
  }
  if (typeof value === "number") n = value;
  else if (typeof value === "bigint") n = Number(value);
  else if (typeof value === "boolean") n = value ? 1 : 0;
  else return fail(type, value, "not a date");
  if (!Number.isInteger(n)) fail(type, value, "not an integer");
  if (n <= max) return n < min ? min : n;
  const seconds = Math.min(n, extended ? INT32_MAX : DATETIME_MAX);
  return clamp(secondsToDays(seconds, timezone), min, max);
}

/** Zero-allocation fast path for exact `YYYY-MM-DD hh:mm:ss` strings.
 *  Returns wall-clock seconds (as if UTC), or `NaN` for any other shape. */
function fastWallClockSeconds(text: string): number {
  if (
    text.length !== 19 ||
    text.charCodeAt(4) !== 45 || // '-'
    text.charCodeAt(7) !== 45 ||
    text.charCodeAt(10) !== 32 || // ' '
    text.charCodeAt(13) !== 58 || // ':'
    text.charCodeAt(16) !== 58
  ) {
    return Number.NaN;
  }
  const year = digitsAt(text, 0, 4);
  const month = digitsAt(text, 5, 2);
  const day = digitsAt(text, 8, 2);
  const hour = digitsAt(text, 11, 2);
  const minute = digitsAt(text, 14, 2);
  const second = digitsAt(text, 17, 2);
  if (
    year < 0 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    !isCalendarDate(year, month, day)
  ) {
    return Number.NaN;
  }
  return (
    daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second
  );
}

/** Parses `YYYY-MM-DD hh:mm:ss[.fff]` without a regular expression. Returns
 *  the wall-clock seconds (as if UTC), or undefined for other shapes. */
function fastWallClock(
  text: string,
): { wall: number; fraction: string } | undefined {
  if (
    text.length < 19 ||
    text.charCodeAt(4) !== 45 || // '-'
    text.charCodeAt(7) !== 45 ||
    text.charCodeAt(10) !== 32 || // ' '
    text.charCodeAt(13) !== 58 || // ':'
    text.charCodeAt(16) !== 58
  ) {
    return undefined;
  }
  const year = digitsAt(text, 0, 4);
  const month = digitsAt(text, 5, 2);
  const day = digitsAt(text, 8, 2);
  const hour = digitsAt(text, 11, 2);
  const minute = digitsAt(text, 14, 2);
  const second = digitsAt(text, 17, 2);
  if (
    year < 0 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    !isCalendarDate(year, month, day)
  ) {
    return undefined;
  }
  let fraction = "";
  if (text.length > 19) {
    if (text.charCodeAt(19) !== 46) return undefined; // '.'
    fraction = text.slice(20);
    if (fraction.length === 0 || digitsAt(fraction, 0, fraction.length) < 0) {
      return undefined;
    }
  }
  return {
    wall:
      daysFromCivil(year, month, day) * 86400 +
      hour * 3600 +
      minute * 60 +
      second,
    fraction,
  };
}

/** The wall-clock seconds (as if UTC) of a date that the calendar has.
 *  Hours, minutes and seconds above their usual limits go to the next unit,
 *  as on the server. */
function wallClock(
  type: ColumnType,
  text: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
): number {
  if (!isCalendarDate(year, month, day)) {
    fail(type, text, "not a date of the calendar");
  }
  return (
    daysFromCivil(year, month, day) * 86400 + hour * 3600 + minute * 60 + second
  );
}

/**
 * Parses the text of a date and time. Returns UTC seconds and the fraction
 * digits. The accepted text:
 *
 * - `YYYY-MM-DD[ hh:mm[:ss[.fff]]]`, also with `T` and with a time zone
 *   (`Z`, `+hh:mm`).
 * - Only digits: 9 or 10 digits are UNIX seconds (a fraction can follow for
 *   `DateTime64`); 13, 16 and 19 digits are UNIX milliseconds, microseconds
 *   and nanoseconds; 6, 8 and 14 digits are `YYYYMM`, `YYYYMMDD` and
 *   `YYYYMMDDhhmmss`.
 */
function parseDateTimeText(
  type: ColumnType,
  text: string,
  timezone: string,
  subsecond: boolean,
): { seconds: number; fraction: string } {
  const fast = fastWallClock(text);
  if (fast !== undefined) {
    return {
      seconds: wallClockToUTC(fast.wall, timezone),
      fraction: fast.fraction,
    };
  }
  const trimmed = text.trim();
  const m = DATE_TIME_RE.exec(trimmed);
  if (m !== null) {
    const wall = wallClock(
      type,
      text,
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      Number(m[4] ?? 0),
      Number(m[5] ?? 0),
      Number(m[6] ?? 0),
    );
    const zone = m[8];
    let seconds: number;
    if (zone === undefined) {
      seconds = wallClockToUTC(wall, timezone);
    } else if (zone.toUpperCase() === "Z") {
      seconds = wall;
    } else {
      const sign = zone.startsWith("-") ? -1 : 1;
      const digits = zone.slice(1).replace(":", "");
      seconds =
        wall -
        sign *
          (Number(digits.slice(0, 2)) * 3600 + Number(digits.slice(2)) * 60);
    }
    return { seconds, fraction: m[7] ?? "" };
  }
  const d = DIGITS_RE.exec(trimmed);
  if (d === null) return fail(type, text, "not a date and time");
  const digits = d[1] as string;
  const fraction = d[2];
  switch (digits.length) {
    case 9:
    case 10:
      // The server accepts a fraction of UNIX seconds only for DateTime64.
      if (fraction !== undefined && !subsecond) break;
      return { seconds: Number(digits), fraction: fraction ?? "" };
    case 13:
    case 16:
    case 19:
      if (fraction !== undefined) break;
      return {
        seconds: Number(digits.slice(0, 10)),
        fraction: digits.slice(10),
      };
    case 6:
    case 8:
    case 14: {
      if (fraction !== undefined && digits.length !== 14) break;
      const wall = wallClock(
        type,
        text,
        digitsAt(digits, 0, 4),
        digitsAt(digits, 4, 2),
        digits.length === 6 ? 1 : digitsAt(digits, 6, 2),
        digits.length === 14 ? digitsAt(digits, 8, 2) : 0,
        digits.length === 14 ? digitsAt(digits, 10, 2) : 0,
        digits.length === 14 ? digitsAt(digits, 12, 2) : 0,
      );
      return {
        seconds: wallClockToUTC(wall, timezone),
        fraction: fraction ?? "",
      };
    }
    default:
      break;
  }
  return fail(type, text, "not a date and time");
}

/** The stored value of a `DateTime` column: UNIX seconds from 0 to 2^32 - 1.
 *  A value out of range becomes the nearest limit, as on the server. */
function toDateTimeSeconds(
  type: ColumnType,
  value: unknown,
  timezone: string,
): number {
  let seconds: number;
  if (typeof value === "string") {
    const fast = fastWallClockSeconds(value);
    seconds = !Number.isNaN(fast)
      ? wallClockToUTC(fast, timezone)
      : parseDateTimeText(type, value, timezone, false).seconds;
  } else if (typeof value === "number") {
    seconds = Math.trunc(value);
  } else if (value instanceof Date) {
    seconds = Math.floor(value.getTime() / 1000);
  } else if (typeof value === "bigint") {
    seconds = Number(value);
  } else {
    return fail(type, value, "not a date and time");
  }
  if (!Number.isFinite(seconds)) {
    return fail(type, value, "not a date and time");
  }
  return clamp(seconds, 0, DATETIME_MAX);
}

/** For each precision, the largest count of seconds for which the count of
 *  ticks is a safe integer. */
const SAFE_SECONDS: number[] = [];
for (let p = 0; p <= 9; p++) {
  SAFE_SECONDS.push(Math.floor(Number.MAX_SAFE_INTEGER / 10 ** p) - 1);
}

/**
 * The stored value of a `DateTime64` column: the count of ticks.
 *
 * - A number (or a `Date`) is UNIX seconds. The server changes seconds out
 *   of the years 0000-9999 to the nearest limit.
 * - Text keeps its date. See {@link parseDateTimeText}.
 * - A count of ticks that does not fit 64 bits is an error.
 */
function toDateTimeTicks(
  type: ColumnType,
  value: unknown,
  precision: number,
  timezone: string,
): bigint {
  let ticks: bigint;
  if (typeof value === "string") {
    const { seconds, fraction } = parseDateTimeText(
      type,
      value,
      timezone,
      true,
    );
    const frac =
      fraction.length >= precision
        ? fraction.slice(0, precision)
        : fraction + "0".repeat(precision - fraction.length);
    if (
      precision <= 9 &&
      seconds > -(SAFE_SECONDS[precision] as number) &&
      seconds < (SAFE_SECONDS[precision] as number)
    ) {
      // The ticks fit a safe integer: one BigInt conversion.
      return BigInt(
        seconds * (POW10_NUMBER[precision] as number) +
          (precision === 0 ? 0 : Number(frac)),
      );
    }
    // As on the server, the whole seconds must fit 64 bits also without the
    // fraction.
    const whole = BigInt(seconds) * pow10(precision);
    if (whole < INT64_MIN || whole > INT64_MAX)
      fail(type, value, "out of range");
    ticks = whole + (precision === 0 ? 0n : BigInt(frac));
  } else {
    const scale = pow10(precision);
    if (value instanceof Date) {
      const ms = value.getTime();
      if (Number.isNaN(ms)) return fail(type, value, "not a date and time");
      ticks =
        precision >= 3
          ? BigInt(ms) * pow10(precision - 3)
          : // Round to the earlier tick, also before 1970.
            BigInt(Math.floor(ms / (POW10_NUMBER[3 - precision] as number)));
    } else if (typeof value === "bigint") {
      ticks = value * scale;
    } else if (typeof value === "number") {
      if (
        Number.isInteger(value) &&
        precision <= 9 &&
        value >= -62167219200 &&
        value <= 253402300799 &&
        Math.abs(value) < (SAFE_SECONDS[precision] as number)
      ) {
        return BigInt(value * (POW10_NUMBER[precision] as number));
      }
      ticks = toScaledDecimal(type, value, precision);
    } else {
      return fail(type, value, "not a date and time");
    }
    if (ticks >= INT64_MIN && ticks <= INT64_MAX) {
      const whole = ticks / scale;
      if (whole > DATETIME64_MAX_SECONDS)
        ticks = DATETIME64_MAX_SECONDS * scale;
      if (whole < DATETIME64_MIN_SECONDS)
        ticks = DATETIME64_MIN_SECONDS * scale;
    }
  }
  if (ticks < INT64_MIN || ticks > INT64_MAX) fail(type, value, "out of range");
  return ticks;
}

/**
 * Parses the text of a time: `[-]hhh:mm:ss`, `[-]mm:ss` or 1 or 2 digits of
 * seconds, each with an optional fraction. Returns the sign, the seconds and
 * the fraction digits (`undefined` if the text has no decimal point).
 */
function parseTimeText(
  type: ColumnType,
  text: string,
): { negative: boolean; seconds: number; fraction: string | undefined } {
  const m = TIME_RE.exec(text);
  if (m === null) return fail(type, text, "not a time");
  let seconds: number;
  if (m[2] !== undefined) {
    seconds = Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
  } else if (m[5] !== undefined) {
    seconds = Number(m[5]) * 60 + Number(m[6]);
  } else {
    seconds = Number(m[7]);
  }
  return { negative: m[1] === "-", seconds, fraction: m[8] };
}

/** An integer for a `Time` or `Time64` column. */
function timeInteger(type: ColumnType, value: unknown): number {
  const n = typeof value === "bigint" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n)) {
    return fail(type, value, "not a time");
  }
  return n;
}

/** The stored value of a `Time` column: seconds from -999:59:59 to
 *  999:59:59. A number is a count of seconds. A value out of range becomes
 *  the nearest limit, as on the server. */
function toTimeSeconds(type: ColumnType, value: unknown): number {
  let seconds: number;
  if (typeof value === "string") {
    const time = parseTimeText(type, value);
    if (time.fraction !== undefined) fail(type, value, "not a time");
    seconds = time.negative ? -time.seconds : time.seconds;
  } else {
    seconds = timeInteger(type, value);
  }
  return clamp(seconds, -TIME_MAX_SECONDS, TIME_MAX_SECONDS);
}

/** The stored value of a `Time64` column: the count of ticks. A number is a
 *  count of ticks (not of seconds), as on the server. A value out of range
 *  becomes the nearest limit. */
function toTimeTicks(
  type: ColumnType,
  value: unknown,
  precision: number,
): bigint {
  const scale = pow10(precision);
  let ticks: bigint;
  if (typeof value === "string") {
    const time = parseTimeText(type, value);
    const frac = ((time.fraction ?? "") + "0".repeat(precision)).slice(
      0,
      precision,
    );
    ticks =
      BigInt(time.seconds) * scale + (precision === 0 ? 0n : BigInt(frac));
    if (time.negative) ticks = -ticks;
  } else if (typeof value === "bigint") {
    ticks = value;
  } else {
    ticks = BigInt(timeInteger(type, value));
  }
  const limit = BigInt(TIME_MAX_SECONDS) * scale;
  // The server keeps the fraction of the last second, and drops the fraction
  // of larger values.
  if (ticks >= limit + scale) return limit;
  if (ticks <= -limit - scale) return -limit;
  return ticks;
}

function toStringOrBytes(type: ColumnType, value: unknown): string | Buffer {
  if (typeof value === "string") return value;
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (typeof value === "object" && value !== null) {
    return stringifyJSON(value);
  }
  return fail(type, value, "not a string");
}

function toBytes(type: ColumnType, value: unknown): Buffer {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return Buffer.from(String(value), "utf8");
  }
  if (typeof value === "object" && value !== null) {
    return Buffer.from(stringifyJSON(value), "utf8");
  }
  return fail(type, value, "not a string");
}

/** `JSON.rawJSON` (Node.js 22 and later) writes text as it is. */
const rawJSON = (JSON as { rawJSON?: (text: string) => unknown }).rawJSON;

/** JSON text of a value. A bigint becomes a JSON number with all its digits
 *  (a string on a runtime without `JSON.rawJSON`). */
export function stringifyJSON(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    typeof v === "bigint"
      ? rawJSON !== undefined
        ? rawJSON(v.toString())
        : v.toString()
      : v,
  );
}

function parseUUID(type: ColumnType, value: unknown): Buffer {
  const hex = typeof value === "string" ? value.trim().replace(/-/g, "") : "";
  if (!/^[0-9a-f]{32}$/i.test(hex)) fail(type, value, "not a UUID");
  const bytes = Buffer.from(hex, "hex");
  const out = Buffer.allocUnsafe(16);
  for (let i = 0; i < 8; i++) {
    out[i] = bytes[7 - i]!;
    out[8 + i] = bytes[15 - i]!;
  }
  return out;
}

function parseIPv4(type: ColumnType, value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) return value >>> 0;
  if (typeof value === "string") {
    const parts = value.trim().split(".");
    if (
      parts.length === 4 &&
      parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) < 256)
    ) {
      return parts.reduce((acc, p) => acc * 256 + Number(p), 0);
    }
  }
  return fail(type, value, "not an IPv4 address");
}

function parseIPv6(type: ColumnType, value: unknown): Buffer {
  if (typeof value !== "string") fail(type, value, "not an IPv6 address");
  let text = value.trim();
  const out = Buffer.alloc(16);
  if (/^\d+\.\d+\.\d+\.\d+$/.test(text)) {
    // An IPv4 address becomes an IPv4-mapped IPv6 address.
    out[10] = 0xff;
    out[11] = 0xff;
    out.writeUInt32BE(parseIPv4(type, text), 12);
    return out;
  }
  const words: number[] = [];
  const v4 = /:(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  let tail: number[] = [];
  if (v4 !== null) {
    const ip = parseIPv4(type, v4[1]);
    tail = [ip >>> 16, ip & 0xffff];
    text = text.slice(0, text.length - (v4[1] as string).length) + "0";
    text = text.replace(/:0$/, ":");
    if (text.endsWith("::")) text += "";
    else text = text.slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) fail(type, value, "not an IPv6 address");
  const parse = (s: string) =>
    s === ""
      ? []
      : s.split(":").map((h) => {
          if (!/^[0-9a-f]{1,4}$/i.test(h))
            fail(type, value, "not an IPv6 address");
          return parseInt(h, 16);
        });
  const head = parse(halves[0] as string);
  const rest = halves.length === 2 ? parse(halves[1] as string) : [];
  const total = head.length + rest.length + tail.length;
  if (halves.length === 1 && total !== 8)
    fail(type, value, "not an IPv6 address");
  if (total > 8) fail(type, value, "not an IPv6 address");
  words.push(
    ...head,
    ...new Array<number>(8 - total).fill(0),
    ...rest,
    ...tail,
  );
  words.forEach((word, i) => out.writeUInt16BE(word, i * 2));
  return out;
}

/** The value of a column type for a NULL or a missing value. */
export function defaultValue(type: ColumnType): unknown {
  switch (type.kind) {
    case "Int":
      return type.bits >= 64 ? 0n : 0;
    case "Float":
    case "BFloat16":
    case "Date":
    case "Date32":
    case "DateTime":
    case "Time":
    case "IPv4":
      return 0;
    case "Bool":
      return false;
    case "String":
      return "";
    case "FixedString":
      return Buffer.alloc(type.size);
    case "Decimal":
    case "DateTime64":
    case "Time64":
      return 0n;
    case "UUID":
    case "IPv6":
      return Buffer.alloc(16);
    case "Enum": {
      // The default of the server is the element with the smallest value.
      let min: number | undefined;
      for (const key of type.values.keys()) {
        if (min === undefined || key < min) min = key;
      }
      return min ?? 0;
    }
    case "Nullable":
      return null;
    case "LowCardinality":
      return defaultValue(type.inner);
    case "Array":
    case "Map":
      return [];
    case "Tuple":
      return type.elements.map(defaultValue);
    case "JSON":
      return "{}";
    default:
      return null;
  }
}

/** Checks a value against the column type and returns its stored form. */
export function normalize(
  type: ColumnType,
  value: unknown,
  ctx: EncodeContext,
): unknown {
  if (value === undefined) value = null;
  switch (type.kind) {
    case "Nullable":
      return value === null ? null : normalize(type.inner, value, ctx);
    case "LowCardinality":
      return normalize(type.inner, value, ctx);
    case "Nothing":
      return null;
    case "Variant":
      return value === null ? null : normalizeVariant(type, value, ctx);
    case "Dynamic":
      return value === null ? null : normalizeDynamic(value, ctx);
    default:
      break;
  }
  if (value === null) {
    if (
      ctx.fallback_for_version_specific_values &&
      (ctx.null_as_default === false || type.kind === "Enum")
    ) {
      throw new ServerParseNeeded("The server applies its NULL input rules");
    }
    if (ctx.null_as_default === false) {
      return fail(type, value, "the column is not Nullable");
    }
    // As `input_format_null_as_default = 1` on the server.
    return defaultValue(type);
  }
  switch (type.kind) {
    case "Int": {
      if (type.bits <= 32) {
        const n = typeof value === "number" ? value : toNumber(type, value);
        const limits = INT_LIMITS_NUMBER[type.bits] as [number, number, number];
        if (!Number.isInteger(n)) fail(type, value, "not an integer");
        if (
          type.signed ? n < limits[0] || n > limits[1] : n < 0 || n > limits[2]
        ) {
          fail(type, value, "out of range");
        }
        return n;
      }
      if (type.bits === 64 && typeof value === "number") {
        if (Number.isSafeInteger(value)) {
          if (!type.signed && value < 0) fail(type, value, "out of range");
          return value;
        }
      }
      const v = toBigInt(type, value);
      const limits = INT_LIMITS[type.bits] as [bigint, bigint, bigint];
      if (
        type.signed ? v < limits[0] || v > limits[1] : v < 0n || v > limits[2]
      ) {
        fail(type, value, "out of range");
      }
      return v;
    }
    case "Float":
    case "BFloat16":
      return toNumber(type, value);
    case "Bool":
      if (typeof value === "boolean") return value;
      if (value === 1 || value === 0) return value === 1;
      if (typeof value === "string") {
        const s = value.trim().toLowerCase();
        if (s === "true" || s === "1") return true;
        if (s === "false" || s === "0") return false;
      }
      return fail(type, value, "not a boolean");
    case "String":
      return toStringOrBytes(type, value);
    case "FixedString": {
      const bytes = toBytes(type, value);
      if (bytes.length > type.size) fail(type, value, "too long");
      const out = Buffer.alloc(type.size);
      bytes.copy(out);
      return out;
    }
    case "Decimal": {
      const v = toScaledDecimal(type, value, type.scale);
      const limits = INT_LIMITS[type.bytes * 8] as [bigint, bigint, bigint];
      if (v < limits[0] || v > limits[1]) fail(type, value, "out of range");
      return v;
    }
    case "Date":
    case "Date32": {
      const extended = type.kind === "Date32";
      const min = extended ? DATE32_MIN : 0;
      const max = extended ? DATE32_MAX : DATE_MAX;
      if (
        ctx.fallback_for_version_specific_values &&
        typeof value === "number" &&
        Number.isInteger(value) &&
        (value < min || value > max)
      ) {
        throw new ServerParseNeeded("The server parses out-of-range dates");
      }
      return toDays(type, value, extended, ctx.timezone);
    }
    case "DateTime":
      return toDateTimeSeconds(type, value, type.timezone ?? ctx.timezone);
    case "DateTime64":
      return toDateTimeTicks(
        type,
        value,
        type.precision,
        type.timezone ?? ctx.timezone,
      );
    case "Time":
      return toTimeSeconds(type, value);
    case "Time64":
      return toTimeTicks(type, value, type.precision);
    case "UUID":
      return parseUUID(type, value);
    case "IPv4":
      return parseIPv4(type, value);
    case "IPv6":
      return parseIPv6(type, value);
    case "Enum": {
      if (typeof value === "number") {
        if (!type.values.has(value)) fail(type, value, "unknown value");
        return value;
      }
      if (typeof value === "string") {
        for (const [n, name] of type.values) if (name === value) return n;
        if (/^-?\d+$/.test(value) && type.values.has(Number(value)))
          return Number(value);
      }
      return fail(type, value, "unknown enum element");
    }
    case "Array": {
      const items = toArray(type, value);
      return items.map((item) => normalize(type.inner, item, ctx));
    }
    case "Tuple": {
      let items: unknown[];
      if (Array.isArray(value)) {
        items = value;
      } else if (typeof value === "object" && type.names !== undefined) {
        const obj = value as Record<string, unknown>;
        items = type.names.map((name) =>
          Object.hasOwn(obj, name) ? obj[name] : undefined,
        );
      } else if (typeof value === "string" && value.trim().startsWith("[")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          return fail(type, value, "not a tuple");
        }
        if (!Array.isArray(parsed)) return fail(type, value, "not a tuple");
        items = parsed;
      } else {
        return fail(type, value, "not a tuple");
      }
      if (items.length !== type.elements.length)
        fail(type, value, "wrong number of elements");
      // A missing element gets the default value.
      return type.elements.map((element, i) =>
        items[i] === undefined
          ? defaultValue(element)
          : normalize(element, items[i], ctx),
      );
    }
    case "Map": {
      let pairs: Array<[unknown, unknown]>;
      if (value instanceof Map) {
        pairs = [...value.entries()];
      } else if (Array.isArray(value)) {
        for (const entry of value) {
          if (!Array.isArray(entry) || entry.length !== 2) {
            return fail(
              type,
              value,
              "each map entry must be a [key, value] pair",
            );
          }
        }
        pairs = value as Array<[unknown, unknown]>;
      } else if (typeof value === "object") {
        pairs = Object.entries(value as Record<string, unknown>);
      } else if (typeof value === "string" && value.trim().startsWith("{")) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          return fail(type, value, "not a map");
        }
        if (
          typeof parsed !== "object" ||
          parsed === null ||
          Array.isArray(parsed)
        ) {
          return fail(type, value, "not a map");
        }
        pairs = Object.entries(parsed as Record<string, unknown>);
      } else {
        return fail(type, value, "not a map");
      }
      return pairs.map(([k, v]) => [
        normalize(type.key, k, ctx),
        normalize(type.value, v, ctx),
      ]);
    }
    case "JSON":
      if (typeof value === "string") return value;
      if (typeof value === "object") return stringifyJSON(value);
      return fail(type, value, "not a JSON object");
    case "SharedVariant":
    case "Unsupported":
      return fail(type, value, "the client cannot insert this type");
    default:
      return fail(type, value);
  }
}

function toArray(type: ColumnType, value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value instanceof Set) return [...value];
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return Array.from(value as unknown as ArrayLike<unknown>);
  }
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try {
      return JSON.parse(value) as unknown[];
    } catch {
      // not JSON
    }
  }
  return fail(type, value, "not an array");
}

/** The kinds that suit a JS value best, for Variant columns. */
function preferredKinds(value: unknown): string[] {
  switch (typeof value) {
    case "string":
      return [
        "String",
        "FixedString",
        "Enum",
        "UUID",
        "IPv4",
        "IPv6",
        "DateTime64",
        "DateTime",
        "Date32",
        "Date",
        "JSON",
      ];
    case "number":
      return Number.isInteger(value)
        ? ["Int", "Float", "Decimal", "Bool"]
        : ["Float", "Decimal"];
    case "bigint":
      return ["Int", "Decimal"];
    case "boolean":
      return ["Bool", "Int"];
    case "object":
      if (value instanceof Date)
        return ["DateTime64", "DateTime", "Date32", "Date"];
      if (Array.isArray(value)) return ["Array", "Tuple", "Map"];
      return ["Map", "Tuple", "JSON"];
    default:
      return [];
  }
}

function normalizeVariant(
  type: Extract<ColumnType, { kind: "Variant" }>,
  value: unknown,
  ctx: EncodeContext,
): VariantNorm {
  const kinds = preferredKinds(value);
  const order = type.variants
    .map((variant, d) => ({ variant, d }))
    .sort((a, b) => rank(kinds, a.variant) - rank(kinds, b.variant));
  for (const { variant, d } of order) {
    try {
      return { d, v: normalize(variant, value, ctx) };
    } catch (err) {
      if (!(err instanceof InsertValueError)) throw err;
    }
  }
  return fail(type, value, "no variant accepts the value");
}

function rank(kinds: string[], type: ColumnType): number {
  const i = kinds.indexOf(type.kind);
  return i === -1 ? kinds.length : i;
}

const INFERRED = new Map<string, ColumnType>();
function inferred(name: string): ColumnType {
  let type = INFERRED.get(name);
  if (type === undefined) {
    // Objects with many different keys make many types: keep the cache small.
    if (INFERRED.size >= 2000) INFERRED.clear();
    type = parseColumnType(name);
    INFERRED.set(name, type);
  }
  return type;
}

/** What the client knows about a JS value in a `Dynamic` column before it
 *  makes a type name. */
type Shape =
  | { k: "null" }
  | { k: "scalar"; name: string; nullable: boolean }
  /** `inner` is `undefined` for an array without elements. */
  | { k: "array"; inner: Shape | undefined }
  /** An object. An object without keys has no fields. */
  | { k: "tuple"; fields: Map<string, Shape> }
  | { k: "dynamic" };

const NULL_SHAPE: Shape = { k: "null" };
const DYNAMIC_SHAPE: Shape = { k: "dynamic" };
const SCALARS: Record<string, Shape> = {};
function scalar(name: string): Shape {
  return (SCALARS[name] ??= { k: "scalar", name, nullable: false });
}

/** Numbers of a higher rank can hold the numbers of a lower rank. */
const NUMERIC_RANK: Record<string, number> = { Bool: 0, Int64: 1, Float64: 2 };
const TWO_63 = 2 ** 63;
const TWO_64 = 2 ** 64;

/**
 * True if the server can find a date or a date and time in the string
 * (`input_format_try_infer_dates`, `input_format_try_infer_datetimes`). The
 * rules of the server have many forms (for example `Jan 2 2024`), and the
 * client does not copy them: only a string without digits, and a string that
 * is a number, are sure to stay a `String`.
 */
function canBeDate(value: string): boolean {
  return /[0-9]/.test(value) && !NUMBER_TEXT_RE.test(value);
}

const NUMBER_TEXT_RE = /^[+-]?[0-9]*\.?[0-9]*(?:[eE][+-]?[0-9]+)?$/;

function shapeOf(value: unknown, dates: boolean): Shape {
  switch (typeof value) {
    case "string":
      if (dates && canBeDate(value)) {
        throw new ServerParseNeeded(
          `The server finds the type of the string ${JSON.stringify(value)} in a Dynamic column`,
        );
      }
      return scalar("String");
    case "boolean":
      return scalar("Bool");
    case "number":
      if (!Number.isInteger(value)) return scalar("Float64");
      if (value >= -TWO_63 && value < TWO_63) return scalar("Int64");
      if (value >= 0 && value < TWO_64) return scalar("UInt64");
      return scalar("Float64");
    case "bigint": {
      if (value >= INT64_MIN && value <= INT64_MAX) return scalar("Int64");
      if (value >= 0n && value < 1n << 64n) return scalar("UInt64");
      return scalar(value < 0n ? "Int256" : "UInt256");
    }
    case "undefined":
      return NULL_SHAPE;
    case "object": {
      if (value === null) return NULL_SHAPE;
      if (value instanceof Date) return scalar("DateTime64(3)");
      if (ArrayBuffer.isView(value)) return scalar("String");
      if (Array.isArray(value)) {
        let inner: Shape | undefined;
        for (const item of value) {
          const shape = shapeOf(item, dates);
          const merged =
            inner === undefined ? shape : mergeShapes(inner, shape);
          // The elements have no common type.
          if (merged === undefined) return { k: "array", inner: DYNAMIC_SHAPE };
          inner = merged;
        }
        return { k: "array", inner };
      }
      const fields = new Map<string, Shape>();
      for (const [key, item] of Object.entries(value)) {
        fields.set(key, shapeOf(item, dates));
      }
      return { k: "tuple", fields };
    }
    default:
      throw new InsertValueError(
        `Cannot insert a value of type ${typeof value} into a Dynamic column`,
      );
  }
}

/** The shape that holds the values of the two shapes, or `undefined` if they
 *  have no common type. */
function mergeShapes(a: Shape, b: Shape): Shape | undefined {
  if (a.k === "null") {
    return b.k === "scalar" && !b.nullable ? { ...b, nullable: true } : b;
  }
  if (b.k === "null") {
    return a.k === "scalar" && !a.nullable ? { ...a, nullable: true } : a;
  }
  if (a.k === "scalar" && b.k === "scalar") {
    const nullable = a.nullable || b.nullable;
    if (a.name === b.name) return a.nullable === nullable ? a : b;
    const rankA = NUMERIC_RANK[a.name];
    const rankB = NUMERIC_RANK[b.name];
    if (rankA === undefined || rankB === undefined) return undefined;
    return { k: "scalar", name: rankA > rankB ? a.name : b.name, nullable };
  }
  if (a.k === "array" && b.k === "array") {
    if (a.inner === undefined) return b;
    if (b.inner === undefined) return a;
    const inner = mergeShapes(a.inner, b.inner);
    return inner === undefined ? undefined : { k: "array", inner };
  }
  if (a.k === "tuple" && b.k === "tuple") {
    const fields = new Map(a.fields);
    for (const [name, shape] of b.fields) {
      const previous = fields.get(name);
      const merged =
        previous === undefined ? shape : mergeShapes(previous, shape);
      if (merged === undefined) return undefined;
      fields.set(name, merged);
    }
    return { k: "tuple", fields };
  }
  return undefined;
}

/** The name of a tuple element as the server writes it in a type name. The
 *  type names must be the names of the server, because the server sorts the
 *  types of a `Dynamic` column by name. */
function elementName(name: string): string {
  if (name === "") {
    throw new InsertValueError(
      "Cannot insert an object with an empty key into a Dynamic column",
    );
  }
  return quoteName(name);
}

function shapeTypeName(shape: Shape): string {
  switch (shape.k) {
    case "null":
      return "Nullable(String)";
    case "scalar":
      return shape.nullable ? `Nullable(${shape.name})` : shape.name;
    case "array":
      return shape.inner === undefined
        ? "Array(String)"
        : `Array(${shapeTypeName(shape.inner)})`;
    case "tuple": {
      // The server reads an object without keys as a string.
      if (shape.fields.size === 0) return "String";
      const elements: string[] = [];
      // The server sorts the keys of an object.
      const fields = [...shape.fields].sort(([a], [b]) => compareBytes(a, b));
      for (const [name, field] of fields) {
        elements.push(`${elementName(name)} ${shapeTypeName(field)}`);
      }
      return `Tuple(${elements.join(", ")})`;
    }
    case "dynamic":
      return "Dynamic";
  }
}

/**
 * The type of a JS value in a `Dynamic` column, as the server finds the type
 * of a JSON value: an object is a named `Tuple`, and the elements of an array
 * get one common type (or `Dynamic`). The client does not find dates in
 * strings: with `dates`, a string that can be a date throws
 * {@link ServerParseNeeded}.
 */
function inferType(value: unknown, dates: boolean): ColumnType {
  return inferred(shapeTypeName(shapeOf(value, dates)));
}

function normalizeDynamic(value: unknown, ctx: EncodeContext): DynamicNorm {
  const t = inferType(value, ctx.infer_dates === true);
  return { t, v: normalize(t, value, ctx) };
}

// ---------------------------------------------------------------------------
// Native layout
// ---------------------------------------------------------------------------

interface Encoded {
  prefix: BinaryWriter;
  data: BinaryWriter;
}

const SHARED_VARIANT: ColumnType = {
  kind: "SharedVariant",
  name: "SharedVariant",
};

/** Writes the state prefix and the data of a column of stored values. */
export function encodeColumn(type: ColumnType, values: unknown[]): Encoded {
  const out: Encoded = {
    prefix: new BinaryWriter(),
    data: new BinaryWriter(),
  };
  writeColumn(out, type, values);
  return out;
}

/** Writes values of a fixed size into one buffer. */
function writeFixed<T>(
  w: BinaryWriter,
  values: unknown[],
  size: number,
  write: (buf: Buffer, value: T, offset: number) => void,
): void {
  const n = values.length;
  const buf = Buffer.allocUnsafe(n * size);
  for (let i = 0; i < n; i++) write(buf, values[i] as T, i * size);
  w.append(buf);
}

function writeColumn(out: Encoded, type: ColumnType, values: unknown[]): void {
  const w = out.data;
  const n = values.length;
  switch (type.kind) {
    case "Int":
      writeInts(w, type.bits, type.signed, values);
      return;
    case "Float":
      if (type.bits === 32) {
        writeFixed<number>(w, values, 4, (b, v, o) => b.writeFloatLE(v, o));
      } else {
        writeFixed<number>(w, values, 8, (b, v, o) => b.writeDoubleLE(v, o));
      }
      return;
    case "BFloat16": {
      const tmp = Buffer.allocUnsafe(4);
      writeFixed<number>(w, values, 2, (b, v, o) => {
        tmp.writeFloatLE(v, 0);
        b.writeUInt16LE(tmp.readUInt16LE(2), o);
      });
      return;
    }
    case "Bool":
      writeFixed<boolean>(w, values, 1, (b, v, o) => {
        b[o] = v ? 1 : 0;
      });
      return;
    case "String":
      for (let i = 0; i < n; i++) {
        const v = values[i];
        if (typeof v === "string") w.string(v);
        else w.bytes(v as Buffer);
      }
      return;
    case "FixedString":
    case "UUID":
    case "IPv6":
      writeFixed<Buffer>(
        w,
        values,
        type.kind === "FixedString" ? type.size : 16,
        (b, v, o) => {
          v.copy(b, o);
        },
      );
      return;
    case "Decimal":
      writeInts(
        w,
        (type.bytes * 8) as 32 | 64 | 128 | 256,
        true,
        // Decimal32 is an Int32: the writer takes numbers for it.
        type.bytes === 4 ? values.map((v) => Number(v)) : values,
      );
      return;
    case "Date":
      writeFixed<number>(w, values, 2, (b, v, o) => b.writeUInt16LE(v, o));
      return;
    case "Date32":
    case "Time":
      writeFixed<number>(w, values, 4, (b, v, o) => b.writeInt32LE(v, o));
      return;
    case "DateTime":
    case "IPv4":
      writeFixed<number>(w, values, 4, (b, v, o) =>
        b.writeUInt32LE(v >>> 0, o),
      );
      return;
    case "DateTime64":
    case "Time64":
      writeFixed<bigint>(w, values, 8, (b, v, o) => b.writeBigInt64LE(v, o));
      return;
    case "Enum":
      if (type.bits === 8) {
        writeFixed<number>(w, values, 1, (b, v, o) => b.writeInt8(v, o));
      } else {
        writeFixed<number>(w, values, 2, (b, v, o) => b.writeInt16LE(v, o));
      }
      return;
    case "Nothing":
      w.append(Buffer.alloc(n, 0x30)); // the server writes '0'
      return;
    case "Nullable": {
      const nulls = Buffer.allocUnsafe(n);
      const inner = new Array<unknown>(n);
      const innerDefault = defaultValue(type.inner);
      for (let i = 0; i < n; i++) {
        const v = values[i];
        nulls[i] = v === null ? 1 : 0;
        inner[i] = v === null ? innerDefault : v;
      }
      w.append(nulls);
      writeColumn(out, type.inner, inner);
      return;
    }
    case "LowCardinality":
      writeLowCardinality(out, type, values);
      return;
    case "Array": {
      let offset = 0;
      const offsets = Buffer.allocUnsafe(n * 8);
      const all: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const items = values[i] as unknown[];
        offset += items.length;
        writeOffset(offsets, offset, i * 8);
        for (const item of items) all.push(item);
      }
      w.append(offsets);
      writeColumn(out, type.inner, all);
      return;
    }
    case "Map": {
      let offset = 0;
      const offsets = Buffer.allocUnsafe(n * 8);
      const keys: unknown[] = [];
      const vals: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const pairs = values[i] as Array<[unknown, unknown]>;
        offset += pairs.length;
        writeOffset(offsets, offset, i * 8);
        for (const [k, val] of pairs) {
          keys.push(k);
          vals.push(val);
        }
      }
      w.append(offsets);
      writeColumn(out, type.key, keys);
      writeColumn(out, type.value, vals);
      return;
    }
    case "Tuple":
      if (type.elements.length === 0) {
        // The server expects one byte for each row of an empty tuple.
        w.append(Buffer.alloc(n));
        return;
      }
      type.elements.forEach((element, i) => {
        writeColumn(
          out,
          element,
          values.map((v) => (v as unknown[])[i]),
        );
      });
      return;
    case "Variant":
      writeVariant(out, type.variants, values as Array<VariantNorm | null>);
      return;
    case "Dynamic":
      writeDynamic(out, values as Array<DynamicNorm | null>);
      return;
    case "JSON": {
      // The STRING serialization: one JSON text for each row.
      out.prefix.u64(1);
      for (let i = 0; i < n; i++) w.string(values[i] as string);
      return;
    }
    default:
      throw new InsertValueError(
        `The client cannot insert columns of type ${type.name}`,
      );
  }
}

/** Writes an array offset (a UInt64) without BigInt arithmetic. */
function writeOffset(buf: Buffer, value: number, offset: number): void {
  buf.writeUInt32LE(value >>> 0, offset);
  buf.writeUInt32LE(Math.floor(value / 0x100000000), offset + 4);
}

function writeInts(
  w: BinaryWriter,
  bits: 8 | 16 | 32 | 64 | 128 | 256,
  signed: boolean,
  values: unknown[],
): void {
  const n = values.length;
  const buf = Buffer.allocUnsafe(n * (bits / 8));
  switch (bits) {
    case 8:
      // The low 8 bits are the same for Int8 and UInt8.
      for (let i = 0; i < n; i++) buf[i] = (values[i] as number) & 0xff;
      break;
    case 16:
      if (signed) {
        for (let i = 0; i < n; i++)
          buf.writeInt16LE(values[i] as number, i * 2);
      } else {
        for (let i = 0; i < n; i++)
          buf.writeUInt16LE(values[i] as number, i * 2);
      }
      break;
    case 32:
      if (signed) {
        for (let i = 0; i < n; i++)
          buf.writeInt32LE(values[i] as number, i * 4);
      } else {
        for (let i = 0; i < n; i++)
          buf.writeUInt32LE(values[i] as number, i * 4);
      }
      break;
    case 64:
      if (signed) {
        for (let i = 0; i < n; i++) {
          const v = values[i] as number | bigint;
          if (typeof v === "number") {
            buf.writeUInt32LE(v >>> 0, i * 8);
            buf.writeInt32LE(Math.floor(v / 0x100000000), i * 8 + 4);
          } else {
            buf.writeBigInt64LE(v, i * 8);
          }
        }
      } else {
        for (let i = 0; i < n; i++) {
          const v = values[i] as number | bigint;
          if (typeof v === "number") {
            buf.writeUInt32LE(v >>> 0, i * 8);
            buf.writeUInt32LE(Math.floor(v / 0x100000000), i * 8 + 4);
          } else {
            buf.writeBigUInt64LE(v, i * 8);
          }
        }
      }
      break;
    default: {
      const words = bits / 64;
      const size = bits / 8;
      for (let i = 0; i < n; i++) {
        let u = BigInt.asUintN(bits, values[i] as bigint);
        for (let word = 0; word < words; word++) {
          buf.writeBigUInt64LE(BigInt.asUintN(64, u), i * size + word * 8);
          u >>= 64n;
        }
      }
    }
  }
  w.append(buf);
}

const LC_HAS_ADDITIONAL_KEYS = 1 << 9;

function writeLowCardinality(
  out: Encoded,
  type: Extract<ColumnType, { kind: "LowCardinality" }>,
  values: unknown[],
): void {
  out.prefix.u64(1); // keys serialization version
  if (values.length === 0) return;
  const nullable = type.inner.kind === "Nullable";
  const dictionaryType = nullable
    ? (type.inner as Extract<ColumnType, { kind: "Nullable" }>).inner
    : type.inner;
  // For Nullable, the key 0 is NULL (its value is the default value).
  const keys: unknown[] = nullable ? [defaultValue(dictionaryType)] : [];
  const positions = new Map<string, number>();
  const indexes: number[] = [];
  for (const v of values) {
    if (nullable && v === null) {
      indexes.push(0);
      continue;
    }
    const key = dictionaryKey(v);
    let position = positions.get(key);
    if (position === undefined) {
      position = keys.length;
      keys.push(v);
      positions.set(key, position);
    }
    indexes.push(position);
  }
  const indexBits = keys.length <= 0x100 ? 8 : keys.length <= 0x10000 ? 16 : 32;
  const keyType = indexBits === 8 ? 0 : indexBits === 16 ? 1 : 2;
  const w = out.data;
  w.u64(keyType | LC_HAS_ADDITIONAL_KEYS);
  w.u64(keys.length);
  // The dictionary has no state prefix.
  const dictionary = encodeColumn(dictionaryType, keys);
  for (const part of dictionary.data.buffers()) w.append(part);
  w.u64(indexes.length);
  writeInts(w, indexBits, false, indexes);
}

function dictionaryKey(v: unknown): string {
  if (typeof v === "string") return "s" + v;
  if (typeof v === "number" || typeof v === "bigint") return "n" + v;
  if (Buffer.isBuffer(v)) return "b" + v.toString("latin1");
  return typeof v + ":" + String(v);
}

function writeVariant(
  out: Encoded,
  variants: ColumnType[],
  values: Array<VariantNorm | null>,
): void {
  out.prefix.u64(0); // BASIC discriminators
  const n = values.length;
  const discriminators = Buffer.allocUnsafe(n);
  const columns: unknown[][] = variants.map(() => []);
  for (let i = 0; i < n; i++) {
    const v = values[i] as VariantNorm | null;
    if (v === null) {
      discriminators[i] = 255;
    } else {
      discriminators[i] = v.d;
      columns[v.d]!.push(v.v);
    }
  }
  out.data.append(discriminators);
  variants.forEach((variant, i) => {
    if (variant.kind === "SharedVariant") return; // never used: no rows
    writeColumn(out, variant, columns[i]!);
  });
}

function writeDynamic(out: Encoded, values: Array<DynamicNorm | null>): void {
  // Serialization V1: the oldest one, which all servers with Dynamic read.
  const types = new Map<string, ColumnType>();
  for (const v of values) if (v !== null) types.set(v.t.name, v.t);
  // Variant discriminators are 1 byte (0..254; 255 is NULL), and SHARED_VARIANT
  // occupies one slot, so at most 254 dynamic types fit in one block.
  if (types.size > 254) {
    throw new ServerParseNeeded(
      `Dynamic column has ${types.size} distinct types in one block (maximum 254)`,
    );
  }
  const variants = [...types.values(), SHARED_VARIANT].sort((a, b) =>
    compareBytes(a.name, b.name),
  );
  out.prefix.u64(1);
  out.prefix.varuint(types.size); // max_dynamic_types
  out.prefix.varuint(types.size);
  for (const t of types.values()) out.prefix.string(t.name);
  const index = new Map(variants.map((t, i) => [t.name, i]));
  writeVariant(
    out,
    variants,
    values.map((v) =>
      v === null ? null : { d: index.get(v.t.name) as number, v: v.v },
    ),
  );
}

/** A Native block (block info, columns, rows) of stored values. */
export function encodeBlock(
  columns: Array<{ name: string; type: ColumnType; values: unknown[] }>,
  rows: number,
  customSerializationFlag: boolean,
): Buffer {
  // The parts of the block. The data of the columns is copied one time, here.
  const parts: Buffer[] = [
    new BinaryWriter()
      .raw(Buffer.from([1, 0, 2, 0xff, 0xff, 0xff, 0xff, 0])) // block info
      .varuint(columns.length)
      .varuint(rows)
      .toBuffer(),
  ];
  for (const column of columns) {
    const head = new BinaryWriter()
      .string(column.name)
      .string(column.type.name);
    if (customSerializationFlag) head.u8(0);
    const { prefix, data } = encodeColumn(column.type, column.values);
    parts.push(head.toBuffer(), prefix.toBuffer());
    for (const part of data.buffers()) parts.push(part);
  }
  return Buffer.concat(parts);
}
