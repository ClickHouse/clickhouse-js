/**
 * Text forms of the values that the Native format sends as numbers or bytes:
 * dates and times, decimals, UUIDs and IP addresses. The text is the same as
 * the server writes in the text formats (for example `JSONEachRow`).
 */

const MS_PER_DAY = 86_400_000;

function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

function pad4(n: number): string {
  if (n >= 1000) return String(n);
  if (n >= 100) return "0" + n;
  if (n >= 10) return "00" + n;
  return "000" + n;
}

/** Days since 1970-01-01 to `YYYY-MM-DD`. */
export function formatDate(days: number): string {
  const d = new Date(days * MS_PER_DAY);
  return (
    pad4(d.getUTCFullYear()) +
    "-" +
    pad2(d.getUTCMonth() + 1) +
    "-" +
    pad2(d.getUTCDate())
  );
}

const TWO_DIGITS: string[] = [];
const TWO_DIGITS_Z: string[] = [];
for (let i = 0; i < 60; i++) {
  const s = pad2(i);
  TWO_DIGITS.push(s);
  TWO_DIGITS_Z.push(s + "Z");
}

const HH_MM: string[] = new Array<string>(1440);
const HH_MM_ISO: string[] = new Array<string>(1440);
for (let h = 0; h < 24; h++) {
  const hh = TWO_DIGITS[h]!;
  for (let m = 0; m < 60; m++) {
    const hm = hh + ":" + TWO_DIGITS[m]! + ":";
    HH_MM[h * 60 + m] = " " + hm;
    HH_MM_ISO[h * 60 + m] = "T" + hm;
  }
}

/** Recent `YYYY-MM-DD` texts by day number: a result often has many values
 *  of the same days. */
const dayTexts = new Map<number, string>();

/** Seconds since the epoch (a wall-clock time as UTC) to `YYYY-MM-DD hh:mm:ss`. */
function formatWallClockSeconds(seconds: number): string {
  const day = Math.floor(seconds / 86400);
  let date = dayTexts.get(day);
  if (date === undefined) {
    date = formatDate(day);
    if (dayTexts.size > 10_000) dayTexts.clear();
    dayTexts.set(day, date);
  }
  const t = seconds - day * 86400;
  return date + HH_MM[(t / 60) | 0]! + TWO_DIGITS[t % 60]!;
}

/** Seconds since the epoch (UTC) to `YYYY-MM-DDThh:mm:ssZ`. */
function formatIsoSeconds(seconds: number): string {
  const day = Math.floor(seconds / 86400);
  let date = dayTexts.get(day);
  if (date === undefined) {
    date = formatDate(day);
    if (dayTexts.size > 10_000) dayTexts.clear();
    dayTexts.set(day, date);
  }
  const t = seconds - day * 86400;
  return date + HH_MM_ISO[(t / 60) | 0]! + TWO_DIGITS_Z[t % 60]!;
}

const UTC_NAMES = new Set(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "UCT", "Zulu"]);

const SECONDS_PER_DAY = 86_400;
const MAX_OFFSET_RANGES = 4096;

/** A range of UTC seconds, `start` to `end` (not included), in which the
 *  time zone has one offset. */
interface OffsetRange {
  start: number;
  end: number;
  offset: number;
}

/**
 * Converts UTC times to the wall-clock time of one time zone.
 *
 * `Intl` gives the offset at one time, and a call is slow. Thus this class
 * keeps the ranges of time that have one offset. It finds them one UTC day at
 * a time: it asks `Intl` for the offset at the first and at the last second
 * of the day. If the two offsets are different, it searches for the second
 * of each change. Ranges that touch and have the same offset become one
 * range, so a lookup is a binary search in a short list.
 *
 * The class assumes that a time zone does not change its offset and then
 * change it back in the same UTC day.
 */
class TimeZoneOffsets {
  private readonly formatter: Intl.DateTimeFormat;
  private readonly ranges: OffsetRange[] = [];
  private last: OffsetRange = { start: 0, end: 0, offset: 0 };

  constructor(timezone: string) {
    this.formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      era: "short",
    });
  }

  /** The offset of the time zone from UTC, in seconds, at the UTC time `seconds`. */
  offset(seconds: number): number {
    const last = this.last;
    if (seconds >= last.start && seconds < last.end) return last.offset;
    let index = this.find(seconds);
    let range = this.ranges[index];
    if (range === undefined || seconds >= range.end) {
      if (this.ranges.length >= MAX_OFFSET_RANGES) {
        this.ranges.length = 0;
      }
      this.addDay(Math.floor(seconds / SECONDS_PER_DAY));
      index = this.find(seconds);
      range = this.ranges[index] as OffsetRange;
    }
    this.last = range;
    return range.offset;
  }

  /** The index of the last range that starts at or before `seconds`, or -1. */
  private find(seconds: number): number {
    const ranges = this.ranges;
    let lo = 0;
    let hi = ranges.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((ranges[mid] as OffsetRange).start <= seconds) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }

  private addDay(day: number): void {
    const first = day * SECONDS_PER_DAY;
    const last = first + SECONDS_PER_DAY - 1;
    this.addRanges(first, last, this.compute(first), this.compute(last));
  }

  /** Adds the ranges of the seconds `first` to `last` (included). */
  private addRanges(
    first: number,
    last: number,
    firstOffset: number,
    lastOffset: number,
  ): void {
    if (firstOffset === lastOffset) {
      this.add({ start: first, end: last + 1, offset: firstOffset });
      return;
    }
    const mid = Math.floor((first + last) / 2);
    this.addRanges(first, mid, firstOffset, this.compute(mid));
    this.addRanges(mid + 1, last, this.compute(mid + 1), lastOffset);
  }

  /** Adds a range, or makes a range longer if the new range touches it and
   *  has the same offset. */
  private add(range: OffsetRange): void {
    const ranges = this.ranges;
    const index = this.find(range.start);
    const before = ranges[index];
    const after = ranges[index + 1];
    const joinsBefore =
      before !== undefined &&
      before.end === range.start &&
      before.offset === range.offset;
    const joinsAfter =
      after !== undefined &&
      after.start === range.end &&
      after.offset === range.offset;
    if (joinsBefore && joinsAfter) {
      before.end = after.end;
      ranges.splice(index + 1, 1);
    } else if (joinsBefore) {
      before.end = range.end;
    } else if (joinsAfter) {
      after.start = range.start;
    } else {
      ranges.splice(index + 1, 0, range);
    }
  }

  private compute(seconds: number): number {
    const parts = this.formatter.formatToParts(new Date(seconds * 1000));
    let year = 0;
    let month = 1;
    let day = 1;
    let hour = 0;
    let minute = 0;
    let second = 0;
    let bc = false;
    for (const part of parts) {
      switch (part.type) {
        case "year":
          year = Number(part.value);
          break;
        case "month":
          month = Number(part.value);
          break;
        case "day":
          day = Number(part.value);
          break;
        case "hour":
          hour = Number(part.value);
          break;
        case "minute":
          minute = Number(part.value);
          break;
        case "second":
          second = Number(part.value);
          break;
        case "era":
          bc = part.value === "BC" || part.value === "B";
          break;
      }
    }
    if (bc) year = 1 - year;
    const wall = new Date(0);
    wall.setUTCFullYear(year, month - 1, day);
    wall.setUTCHours(hour, minute, second, 0);
    return Math.round(wall.getTime() / 1000) - seconds;
  }
}

const zones = new Map<string, TimeZoneOffsets | null>();

/** The offsets of a time zone, or `null` for UTC. Throws an error if Node.js
 *  does not know the time zone: the client cannot write its times. */
function zoneOffsets(timezone: string): TimeZoneOffsets | null {
  let zone = zones.get(timezone);
  if (zone === undefined) {
    if (UTC_NAMES.has(timezone)) {
      zone = null;
    } else {
      try {
        zone = new TimeZoneOffsets(timezone);
      } catch (err) {
        throw new Error(
          `The time zone ${JSON.stringify(timezone)} is not known to this Node.js runtime. ` +
            "The client cannot write the DateTime values of this time zone.",
          { cause: err },
        );
      }
    }
    zones.set(timezone, zone);
  }
  return zone;
}

/** The offset of the time zone from UTC (in seconds) at a UTC time. */
export function timezoneOffset(seconds: number, timezone: string): number {
  const zone = zoneOffsets(timezone);
  return zone === null ? 0 : zone.offset(seconds);
}

/** A wall-clock time in the time zone (seconds, as if it were UTC) to UTC
 *  seconds. In a gap or an overlap of daylight saving time, the result is one
 *  of the possible times. */
export function wallClockToUTC(wall: number, timezone: string): number {
  if (zoneOffsets(timezone) === null) return wall; // UTC
  const guess = wall - timezoneOffset(wall, timezone);
  return wall - timezoneOffset(guess, timezone);
}

/**
 * The values of the `date_time_output_format` setting:
 *
 * - `simple`: `YYYY-MM-DD hh:mm:ss[.fff]` in the time zone of the column
 * - `iso`: `YYYY-MM-DDThh:mm:ss[.fff]Z`, always in UTC
 * - `unix_timestamp`: the seconds since the epoch, `1704110400[.fff]`
 */
export type DateTimeOutputFormat = "simple" | "iso" | "unix_timestamp";

/** Resolves a `DateTime` formatter once per column to avoid per-row timezone map lookups. */
export function createDateTimeFormatter(
  timezone: string,
  format: DateTimeOutputFormat = "simple",
): (seconds: number) => string {
  if (format === "simple") {
    const zone = zoneOffsets(timezone);
    if (zone === null) return formatWallClockSeconds;
    return (seconds) => formatWallClockSeconds(seconds + zone.offset(seconds));
  }
  if (format === "iso") return formatIsoSeconds;
  return String;
}

/** UTC seconds since the epoch to the text of a `DateTime` value. */
export function formatDateTime(
  seconds: number,
  timezone: string,
  format: DateTimeOutputFormat = "simple",
): string {
  if (format === "simple") {
    const zone = zoneOffsets(timezone);
    const offset = zone === null ? 0 : zone.offset(seconds);
    return formatWallClockSeconds(seconds + offset);
  }
  if (format === "iso") {
    return formatIsoSeconds(seconds);
  }
  return String(seconds);
}

const POW10: bigint[] = [];
for (let i = 0n; i <= 76n; i++) POW10.push(10n ** i);

function floorDiv(a: bigint, b: bigint): [bigint, bigint] {
  let q = a / b;
  let r = a % b;
  if (r < 0n) {
    q -= 1n;
    r += b;
  }
  return [q, r];
}

/** DateTime64 ticks to the text of a `DateTime64` value. */
export function formatDateTime64(
  ticks: bigint,
  precision: number,
  timezone: string,
  format: DateTimeOutputFormat = "simple",
  cutZeros = false,
): string {
  const scale = POW10[precision] as bigint;
  if (format === "unix_timestamp") {
    // A time before the epoch has a negative number of seconds.
    const negative = ticks < 0n;
    const abs = negative ? -ticks : ticks;
    const text = (negative ? "-" : "") + (abs / scale).toString();
    if (precision === 0) return text;
    return text + "." + (abs % scale).toString().padStart(precision, "0");
  }
  const [seconds, fraction] = floorDiv(ticks, scale);
  const text = formatDateTime(Number(seconds), timezone, format);
  if (precision === 0) return text;
  if (cutZeros && format === "simple") {
    // `date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands`:
    // no zeros at the end, then 3, 6 or 9 digits. No digits for a full second.
    const cut = fraction.toString().padStart(precision, "0").replace(/0+$/, "");
    if (cut === "") return text;
    return text + "." + cut.padEnd(Math.ceil(cut.length / 3) * 3, "0");
  }
  const digits = "." + fraction.toString().padStart(precision, "0");
  return format === "iso" ? text.slice(0, -1) + digits + "Z" : text + digits;
}

/** Time (seconds) to `[-]hh:mm:ss`. Hours can have more than two digits. */
export function formatTime(seconds: number): string {
  const sign = seconds < 0 ? "-" : "";
  const abs = Math.abs(seconds);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = abs % 60;
  return sign + pad2(h) + ":" + pad2(m) + ":" + pad2(s);
}

/** Time64 ticks to `[-]hh:mm:ss[.fff]`. */
export function formatTime64(ticks: bigint, precision: number): string {
  const negative = ticks < 0n;
  const abs = negative ? -ticks : ticks;
  const scale = POW10[precision] as bigint;
  const seconds = Number(abs / scale);
  const text = formatTime(negative ? -seconds : seconds);
  if (precision === 0) return text;
  const prefix = negative && seconds === 0 ? "-" : "";
  return (
    prefix + text + "." + (abs % scale).toString().padStart(precision, "0")
  );
}

/** A decimal value (the integer of the stored value and the scale) to text. */
export function formatDecimal(
  value: bigint,
  scale: number,
  trailingZeros: boolean,
): string {
  if (scale === 0) return value.toString();
  const negative = value < 0n;
  const digits = (negative ? -value : value)
    .toString()
    .padStart(scale + 1, "0");
  const integer = digits.slice(0, digits.length - scale);
  let fraction = digits.slice(digits.length - scale);
  if (!trailingZeros) {
    fraction = fraction.replace(/0+$/, "");
  }
  return (
    (negative ? "-" : "") +
    integer +
    (fraction.length > 0 ? "." + fraction : "")
  );
}

const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push(i.toString(16).padStart(2, "0"));

/** A UUID is two little-endian UInt64 values: the high half, then the low half. */
export function formatUUID(buf: Buffer, offset: number): string {
  let s = "";
  for (let i = 7; i >= 0; i--) s += HEX[buf[offset + i] as number];
  for (let i = 15; i >= 8; i--) s += HEX[buf[offset + i] as number];
  return (
    s.slice(0, 8) +
    "-" +
    s.slice(8, 12) +
    "-" +
    s.slice(12, 16) +
    "-" +
    s.slice(16, 20) +
    "-" +
    s.slice(20)
  );
}

/** IPv4 is a little-endian UInt32. */
export function formatIPv4(value: number): string {
  return (
    (value >>> 24) +
    "." +
    ((value >>> 16) & 0xff) +
    "." +
    ((value >>> 8) & 0xff) +
    "." +
    (value & 0xff)
  );
}

/** IPv6 is 16 bytes in network order. The text is the same as the server
 *  writes: the longest run of zero groups (two or more) becomes `::`, and
 *  IPv4-mapped and IPv4-compatible addresses end with the IPv4 address. */
export function formatIPv6(buf: Buffer, offset: number): string {
  const words: number[] = [];
  for (let i = 0; i < 8; i++) {
    words.push(
      ((buf[offset + 2 * i] as number) << 8) |
        (buf[offset + 2 * i + 1] as number),
    );
  }
  let bestBase = -1;
  let bestLen = 0;
  let curBase = -1;
  let curLen = 0;
  for (let i = 0; i < 8; i++) {
    if (words[i] === 0) {
      if (curBase === -1) {
        curBase = i;
        curLen = 1;
      } else {
        curLen++;
      }
    } else if (curBase !== -1) {
      if (bestBase === -1 || curLen > bestLen) {
        bestBase = curBase;
        bestLen = curLen;
      }
      curBase = -1;
    }
  }
  if (curBase !== -1 && (bestBase === -1 || curLen > bestLen)) {
    bestBase = curBase;
    bestLen = curLen;
  }
  if (bestBase !== -1 && bestLen < 2) bestBase = -1;

  let out = "";
  for (let i = 0; i < 8; i++) {
    if (bestBase !== -1 && i >= bestBase && i < bestBase + bestLen) {
      if (i === bestBase) out += ":";
      continue;
    }
    if (i !== 0) out += ":";
    if (
      i === 6 &&
      bestBase === 0 &&
      (bestLen === 6 || (bestLen === 5 && words[5] === 0xffff))
    ) {
      out +=
        buf[offset + 12] +
        "." +
        buf[offset + 13] +
        "." +
        buf[offset + 14] +
        "." +
        buf[offset + 15];
      return out;
    }
    out += (words[i] as number).toString(16);
  }
  if (bestBase !== -1 && bestBase + bestLen === 8) out += ":";
  return out;
}
