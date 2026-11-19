import { constants, isAscii, isUtf8 } from "node:buffer";
import { BinaryReader, ProtocolError } from "./binary";
import { readBinaryType } from "./binary_types";
import type { Column } from "./packets";
import type { ColumnType } from "./types";
import { compareBytes, parseColumnType } from "./types";
import type { DateTimeOutputFormat } from "./text";
import {
  formatDate,
  formatDateTime,
  formatDateTime64,
  formatIPv4,
  formatIPv6,
  formatTime,
  formatTime64,
  formatUUID,
} from "./text";

/**
 * Decoded values. The {@link ColumnType} of a column tells how to show its
 * values in an output format:
 *
 * - `Int8`-`Int32`, `UInt8`-`UInt32`, floats: `number`
 * - `Int64`-`Int256`, `UInt64`-`UInt256`: `bigint`
 * - `Bool`: `boolean`
 * - `String`, `FixedString`, `Enum*`, `UUID`, `IPv4`, `IPv6`, date and time types: `string`
 * - `Decimal*`: {@link DecimalValue}
 * - `Nullable(T)`, `Nothing`: `null` or the value of `T`
 * - `Array(T)`, `Tuple(...)`: an array
 * - `Map(K, V)`: an array of `[key, value]` pairs
 * - `Variant(...)`, `Dynamic`: `null` or a {@link TypedValue}
 * - `JSON`: a {@link RawJSONValue} or a {@link JSONObjectValue}
 */
export class DecimalValue {
  readonly value: bigint;
  readonly scale: number;
  constructor(value: bigint, scale: number) {
    this.value = value;
    this.scale = scale;
  }
}

/** A value of a `Variant` or `Dynamic` column, with its actual type. */
export class TypedValue {
  readonly type: ColumnType;
  readonly value: unknown;
  constructor(type: ColumnType, value: unknown) {
    this.type = type;
    this.value = value;
  }
}

/** A `JSON` value that the server sent as JSON text. */
export class RawJSONValue {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

/** A `JSON` value that the server sent as paths. Only the paths with values
 *  are in `paths`; `null` values of dynamic paths are left out. */
export class JSONObjectValue {
  readonly paths: Array<[path: string, type: ColumnType, value: unknown]>;
  constructor(paths: Array<[string, ColumnType, unknown]>) {
    this.paths = paths;
  }
}

/** Settings that change how the values are decoded. */
export interface DecodeContext {
  /** The time zone for `DateTime` and `DateTime64` columns without one. */
  timezone: string;
  /** The Data, Totals and Extremes packets of the request are compressed. */
  compressed?: boolean;
  /** The text form of `DateTime` and `DateTime64` values (the
   *  `date_time_output_format` setting). */
  date_time_output_format?: DateTimeOutputFormat;
  /** `DateTime64` text without zeros at the end of the fraction (the
   *  `date_time_64_output_format_cut_trailing_zeros_align_to_groups_of_thousands`
   *  setting). */
  date_time64_cut_zeros?: boolean;
  /** The decoder sets this when a string has bytes that are not UTF-8.
   *  See {@link decodeString}. */
  raw_bytes?: boolean;
  /** Preserve simple Data columns until the consumer chooses text or rows. */
  binary_columns?: { enabled: boolean };
  /** The packet that is not complete yet. The packet reader keeps the
   *  columns that it decoded, and continues after them when more data
   *  comes. */
  pending?: PendingPacket;
}

/** The state of a block that the reader decoded only in part. */
export interface PendingBlock {
  /** The decoded columns, or `undefined` before the block header is read. */
  columns?: Column[];
  column_count: number;
  rows: number;
  /** The offset after the last decoded column, from the start of the block. */
  offset: number;
}

/** The state of a packet that the reader decoded only in part. */
export interface PendingPacket {
  block?: PendingBlock;
  /** Compressed packets: the offset after the last compressed block that was
   *  read, from the start of the first one. */
  frames_offset?: number;
  /** Compressed packets: the decompressed data. */
  data?: GrowableBuffer;
}

const MAX_KEPT_CAPACITY = 1 << 20;

/** Bytes that grow at the end and are removed at the start. */
export class GrowableBuffer {
  private buf: Buffer = Buffer.allocUnsafe(0);
  private start = 0;
  private end = 0;

  get length(): number {
    return this.end - this.start;
  }

  append(part: Buffer): void {
    if (this.end + part.length > this.buf.length) {
      const length = this.end - this.start;
      const next = Buffer.allocUnsafe(
        Math.max(length + part.length, this.buf.length * 2),
      );
      this.buf.copy(next, 0, this.start, this.end);
      this.buf = next;
      this.start = 0;
      this.end = length;
    }
    part.copy(this.buf, this.end);
    this.end += part.length;
  }

  /** Removes `n` bytes from the start. */
  consume(n: number): void {
    this.start += n;
    if (this.start === this.end) {
      // Empty: use the memory again, but do not keep much of it.
      this.start = 0;
      this.end = 0;
      if (this.buf.length > MAX_KEPT_CAPACITY) this.buf = Buffer.allocUnsafe(0);
    }
  }

  /** The bytes. The view is valid until the next {@link append}. */
  view(): Buffer {
    return this.buf.subarray(this.start, this.end);
  }
}

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

/**
 * Decodes the UTF-8 bytes of a `String` value.
 *
 * A ClickHouse `String` can have bytes that are not UTF-8 (for example a
 * hash). A JS string cannot hold them: the usual decoder changes each of them
 * to U+FFFD. To keep the bytes, this function changes each byte that is not
 * part of a valid UTF-8 sequence to a lone low surrogate (U+DC80 to U+DCFF:
 * 0xDC00 + the byte), and sets `ctx.raw_bytes`. Valid UTF-8 never gives a
 * lone surrogate. {@link encodeText} changes them back to the bytes.
 */
export function decodeString(
  buf: Buffer,
  start: number,
  end: number,
  ctx: DecodeContext,
): string {
  const s = buf.toString("utf8", start, end);
  // U+FFFD shows that the value can have bytes that are not UTF-8.
  if (!s.includes("\ufffd")) return s;
  if (Buffer.from(s, "utf8").equals(buf.subarray(start, end))) return s;
  ctx.raw_bytes = true;
  let out = "";
  let run = start;
  let i = start;
  while (i < end) {
    const n = utf8SequenceLength(buf, i, end);
    if (n > 0) {
      i += n;
      continue;
    }
    if (i > run) out += buf.toString("utf8", run, i);
    out += String.fromCharCode(0xdc00 + (buf[i] as number));
    i++;
    run = i;
  }
  if (end > run) out += buf.toString("utf8", run, end);
  return out;
}

/** The length of the valid UTF-8 sequence at `i`, or 0 if there is none
 *  (Table 3-7 of the Unicode Standard). */
function utf8SequenceLength(buf: Buffer, i: number, end: number): number {
  const b0 = buf[i] as number;
  if (b0 < 0x80) return 1;
  if (b0 < 0xc2) return 0;
  const cont = (j: number, lo = 0x80, hi = 0xbf): boolean => {
    if (j >= end) return false;
    const b = buf[j] as number;
    return b >= lo && b <= hi;
  };
  if (b0 < 0xe0) return cont(i + 1) ? 2 : 0;
  if (b0 < 0xf0) {
    const lo = b0 === 0xe0 ? 0xa0 : 0x80;
    const hi = b0 === 0xed ? 0x9f : 0xbf;
    return cont(i + 1, lo, hi) && cont(i + 2) ? 3 : 0;
  }
  if (b0 < 0xf5) {
    const lo = b0 === 0xf0 ? 0x90 : 0x80;
    const hi = b0 === 0xf4 ? 0x8f : 0xbf;
    return cont(i + 1, lo, hi) && cont(i + 2) && cont(i + 3) ? 4 : 0;
  }
  return 0;
}

// A low surrogate U+DC80 to U+DCFF that does not follow a high surrogate.
const ESCAPED_BYTE = /(?<![\ud800-\udbff])[\udc80-\udcff]/g;

/** Changes the text of a result to bytes. The lone surrogates that
 *  {@link decodeString} made become the original bytes again. */
export function encodeText(text: string): Buffer {
  const parts: Buffer[] = [];
  let last = 0;
  ESCAPED_BYTE.lastIndex = 0;
  for (;;) {
    const match = ESCAPED_BYTE.exec(text);
    if (match === null) break;
    if (match.index > last) {
      parts.push(Buffer.from(text.slice(last, match.index), "utf8"));
    }
    parts.push(Buffer.from([text.charCodeAt(match.index) - 0xdc00]));
    last = match.index + 1;
  }
  if (last === 0) return Buffer.from(text, "utf8");
  if (last < text.length) parts.push(Buffer.from(text.slice(last), "utf8"));
  return Buffer.concat(parts);
}

/** Reads a VarUInt length and a string value (see {@link decodeString}). */
function readString(r: BinaryReader, ctx: DecodeContext): string {
  const len = r.varuint();
  r.ensure(len);
  const s = decodeString(r.buf, r.pos, r.pos + len, ctx);
  r.pos += len;
  return s;
}

/** Finds the bounds of a String column without decoding individual strings. */
function scanStringColumn(
  r: BinaryReader,
  rows: number,
): { end: number; short: boolean } {
  const buf = r.buf;
  const limit = buf.length;
  let pos = r.pos;
  let short = true;
  for (let i = 0; i < rows; i++) {
    let len = 0;
    let multiplier = 1;
    for (;;) {
      // Each of the next rows needs one byte or more.
      if (pos >= limit) r.ensure(pos - r.pos + rows - i);
      const byte = buf[pos++] as number;
      len += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) break;
      short = false;
      multiplier *= 128;
      if (multiplier > 2 ** 56) {
        throw new ProtocolError("A string length is too large");
      }
    }
    pos += len;
    if (pos > limit) r.ensure(pos - r.pos + rows - i - 1);
  }
  return { end: pos, short };
}

function readStrings(
  r: BinaryReader,
  rows: number,
  ctx: DecodeContext,
): string[] {
  const buf = r.buf;
  const { end: pos, short } = scanStringColumn(r, rows);
  const out = new Array<string>(rows);
  if (
    rows > 1 &&
    short &&
    pos - r.pos <= constants.MAX_STRING_LENGTH &&
    isAscii(buf.subarray(r.pos, pos))
  ) {
    // Each length prefix fits in one byte, so its byte offset is also its
    // offset in the decoded string. Decode the entire column once.
    const ascii = buf.toString("latin1", r.pos, pos);
    let offset = 0;
    for (let i = 0; i < rows; i++) {
      const len = ascii.charCodeAt(offset++);
      out[i] = ascii.slice(offset, offset + len);
      offset += len;
    }
    r.pos = pos;
    return out;
  }
  for (let i = 0; i < rows; i++) out[i] = readString(r, ctx);
  return out;
}

/** Keeps a column whose bytes can be used directly by the JSON row writer. */
export function readBinaryColumn(
  r: BinaryReader,
  type: ColumnType,
  rows: number,
): Buffer | undefined {
  const start = r.pos;
  let end: number;
  if (type.kind === "String") {
    const strings = scanStringColumn(r, rows);
    end = strings.end;
    // Each one-byte length is ASCII. It prevents an incomplete UTF-8
    // sequence at the end of one value from continuing into the next.
    if (!strings.short || !isUtf8(r.buf.subarray(start, end))) return;
  } else if (
    type.kind === "Int" &&
    type.bits <= 64 &&
    !type.name.startsWith("Interval")
  ) {
    const size = (type.bits / 8) * rows;
    r.ensure(size);
    end = start + size;
  } else if (type.kind === "Bool") {
    r.ensure(rows);
    end = start + rows;
  } else {
    return;
  }
  r.pos = end;
  // The packet reader can reuse its receive buffer as soon as it advances.
  return Buffer.from(r.buf.subarray(start, end));
}

function readEnums(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "Enum" }>,
  rows: number,
  nulls: Buffer | undefined,
): Array<string | null> {
  const out = new Array<string | null>(rows);
  const size = type.bits / 8;
  r.ensure(rows * size);
  for (let i = 0; i < rows; i++, r.pos += size) {
    if (nulls !== undefined && nulls[i] !== 0) {
      // A NULL row can hold a number that is not a value of the Enum.
      out[i] = null;
      continue;
    }
    const v = size === 1 ? r.buf.readInt8(r.pos) : r.buf.readInt16LE(r.pos);
    const name = type.values.get(v);
    if (name === undefined) {
      throw new ProtocolError(`Unknown value ${v} of ${type.name}`);
    }
    out[i] = name;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Serialization state prefixes
// ---------------------------------------------------------------------------

/** The data that comes before the column data (the "state prefix"). */
type State =
  | undefined
  | { s: "inner"; inner: State }
  | { s: "elements"; elements: State[] }
  | { s: "variant"; compact: boolean; variants: State[] }
  | {
      s: "dynamic";
      flattened: true;
      types: ColumnType[];
      states: State[];
    }
  | {
      s: "dynamic";
      flattened: false;
      variant: Extract<ColumnType, { kind: "Variant" }>;
      state: State;
    }
  | { s: "json_string" }
  | {
      s: "json_flattened";
      paths: string[];
      typed: State[];
      dynamic: State[];
    }
  | {
      s: "json_paths";
      dynamic_paths: string[];
      typed: State[];
      dynamic: State[];
    };

const DYNAMIC_V1 = 1;
const DYNAMIC_V2 = 2;
const DYNAMIC_FLATTENED = 3;
const JSON_V1 = 0;
const JSON_V2 = 2;
const JSON_STRING = 1;
const JSON_FLATTENED = 3;
const LOW_CARDINALITY_KEYS_VERSION = 1;

const SHARED_VARIANT: ColumnType = {
  kind: "SharedVariant",
  name: "SharedVariant",
};

export function readPrefix(r: BinaryReader, type: ColumnType): State {
  switch (type.kind) {
    case "Nullable":
    case "Array":
      return { s: "inner", inner: readPrefix(r, type.inner) };
    case "LowCardinality": {
      const version = r.u64n();
      if (version !== LOW_CARDINALITY_KEYS_VERSION) {
        throw new ProtocolError(
          `Unsupported LowCardinality keys serialization version ${version}`,
        );
      }
      return undefined;
    }
    case "Map":
      return {
        s: "elements",
        elements: [readPrefix(r, type.key), readPrefix(r, type.value)],
      };
    case "Tuple":
      return {
        s: "elements",
        elements: type.elements.map((element) => readPrefix(r, element)),
      };
    case "Variant": {
      const mode = r.u64n();
      return {
        s: "variant",
        compact: mode === 1,
        variants: type.variants.map((variant) => readPrefix(r, variant)),
      };
    }
    case "Dynamic":
      return readDynamicPrefix(r);
    case "JSON":
      return readJSONPrefix(r, type);
    default:
      return undefined;
  }
}

function readDynamicPrefix(r: BinaryReader): State {
  const version = r.u64n();
  if (version === DYNAMIC_FLATTENED) {
    const count = r.varuint();
    const types: ColumnType[] = [];
    for (let i = 0; i < count; i++) types.push(parseColumnType(r.string()));
    return {
      s: "dynamic",
      flattened: true,
      types,
      states: types.map((type) => readPrefix(r, type)),
    };
  }
  if (version !== DYNAMIC_V1 && version !== DYNAMIC_V2) {
    throw new ProtocolError(
      `Unsupported Dynamic serialization version ${version}`,
    );
  }
  if (version === DYNAMIC_V1) r.varuint(); // max_dynamic_types (not used)
  const count = r.varuint();
  const variants: ColumnType[] = [SHARED_VARIANT];
  for (let i = 0; i < count; i++) variants.push(parseColumnType(r.string()));
  variants.sort((a, b) => compareBytes(a.name, b.name));
  const variant: Extract<ColumnType, { kind: "Variant" }> = {
    kind: "Variant",
    name: `Variant(${variants.map((v) => v.name).join(", ")})`,
    variants,
  };
  return {
    s: "dynamic",
    flattened: false,
    variant,
    state: readPrefix(r, variant),
  };
}

function readJSONPrefix(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "JSON" }>,
): State {
  const version = r.u64n();
  if (version === JSON_STRING) {
    return { s: "json_string" };
  }
  if (version === JSON_FLATTENED) {
    const count = r.varuint();
    const paths: string[] = [];
    for (let i = 0; i < count; i++) paths.push(r.string());
    const typed = type.typed_paths.map(([, t]) => readPrefix(r, t));
    const dynamic = paths.map(() => readDynamicPrefix(r));
    return { s: "json_flattened", paths, typed, dynamic };
  }
  if (version !== JSON_V1 && version !== JSON_V2) {
    throw new ProtocolError(
      `Unsupported JSON serialization version ${version}`,
    );
  }
  if (version === JSON_V1) r.varuint(); // max_dynamic_paths (not used)
  const count = r.varuint();
  const dynamic_paths: string[] = [];
  for (let i = 0; i < count; i++) dynamic_paths.push(r.string());
  const typed = type.typed_paths.map(([, t]) => readPrefix(r, t));
  const dynamic = dynamic_paths.map(() => readDynamicPrefix(r));
  // The shared data is Map(String, String): no prefix.
  return { s: "json_paths", dynamic_paths, typed, dynamic };
}

// ---------------------------------------------------------------------------
// Column data
// ---------------------------------------------------------------------------

export function readColumn(
  r: BinaryReader,
  type: ColumnType,
  rows: number,
  state: State,
  ctx: DecodeContext,
): unknown[] {
  if (rows === 0) return [];
  switch (type.kind) {
    case "Int":
      return readInts(r, type.bits, type.signed, rows);
    case "Float": {
      const out = new Array<number>(rows);
      if (type.bits === 32) {
        r.ensure(rows * 4);
        for (let i = 0; i < rows; i++, r.pos += 4)
          out[i] = r.buf.readFloatLE(r.pos);
      } else {
        r.ensure(rows * 8);
        for (let i = 0; i < rows; i++, r.pos += 8)
          out[i] = r.buf.readDoubleLE(r.pos);
      }
      return out;
    }
    case "BFloat16": {
      const out = new Array<number>(rows);
      r.ensure(rows * 2);
      const tmp = Buffer.alloc(4);
      for (let i = 0; i < rows; i++, r.pos += 2) {
        tmp.writeUInt16LE(r.buf.readUInt16LE(r.pos), 2);
        out[i] = tmp.readFloatLE(0);
      }
      return out;
    }
    case "Bool": {
      const out = new Array<boolean>(rows);
      r.ensure(rows);
      for (let i = 0; i < rows; i++) out[i] = r.buf[r.pos++] !== 0;
      return out;
    }
    case "String":
      return readStrings(r, rows, ctx);
    case "FixedString": {
      const out = new Array<string>(rows);
      r.ensure(rows * type.size);
      for (let i = 0; i < rows; i++, r.pos += type.size) {
        out[i] = decodeString(r.buf, r.pos, r.pos + type.size, ctx);
      }
      return out;
    }
    case "Decimal": {
      const ints = readInts(
        r,
        (type.bytes * 8) as 32 | 64 | 128 | 256,
        true,
        rows,
      );
      return ints.map(
        (v) => new DecimalValue(BigInt(v as number | bigint), type.scale),
      );
    }
    case "Date": {
      const out = new Array<string>(rows);
      r.ensure(rows * 2);
      for (let i = 0; i < rows; i++, r.pos += 2)
        out[i] = formatDate(r.buf.readUInt16LE(r.pos));
      return out;
    }
    case "Date32": {
      const out = new Array<string>(rows);
      r.ensure(rows * 4);
      for (let i = 0; i < rows; i++, r.pos += 4)
        out[i] = formatDate(r.buf.readInt32LE(r.pos));
      return out;
    }
    case "DateTime": {
      const tz = type.timezone ?? ctx.timezone;
      const format = ctx.date_time_output_format;
      const out = new Array<string>(rows);
      r.ensure(rows * 4);
      for (let i = 0; i < rows; i++, r.pos += 4) {
        out[i] = formatDateTime(r.buf.readUInt32LE(r.pos), tz, format);
      }
      return out;
    }
    case "DateTime64": {
      const tz = type.timezone ?? ctx.timezone;
      const format = ctx.date_time_output_format;
      const cutZeros = ctx.date_time64_cut_zeros;
      const out = new Array<string>(rows);
      r.ensure(rows * 8);
      for (let i = 0; i < rows; i++, r.pos += 8) {
        out[i] = formatDateTime64(
          r.buf.readBigInt64LE(r.pos),
          type.precision,
          tz,
          format,
          cutZeros,
        );
      }
      return out;
    }
    case "Time": {
      const out = new Array<string>(rows);
      r.ensure(rows * 4);
      for (let i = 0; i < rows; i++, r.pos += 4)
        out[i] = formatTime(r.buf.readInt32LE(r.pos));
      return out;
    }
    case "Time64": {
      const out = new Array<string>(rows);
      r.ensure(rows * 8);
      for (let i = 0; i < rows; i++, r.pos += 8) {
        out[i] = formatTime64(r.buf.readBigInt64LE(r.pos), type.precision);
      }
      return out;
    }
    case "UUID": {
      const out = new Array<string>(rows);
      r.ensure(rows * 16);
      for (let i = 0; i < rows; i++, r.pos += 16)
        out[i] = formatUUID(r.buf, r.pos);
      return out;
    }
    case "IPv4": {
      const out = new Array<string>(rows);
      r.ensure(rows * 4);
      for (let i = 0; i < rows; i++, r.pos += 4)
        out[i] = formatIPv4(r.buf.readUInt32LE(r.pos));
      return out;
    }
    case "IPv6": {
      const out = new Array<string>(rows);
      r.ensure(rows * 16);
      for (let i = 0; i < rows; i++, r.pos += 16)
        out[i] = formatIPv6(r.buf, r.pos);
      return out;
    }
    case "Enum":
      return readEnums(r, type, rows, undefined);
    case "Nothing": {
      // The server writes one byte for each row.
      r.skip(rows);
      return new Array<null>(rows).fill(null);
    }
    case "Nullable": {
      const nulls = r.fixed(rows);
      if (type.inner.kind === "Enum") {
        return readEnums(r, type.inner, rows, nulls);
      }
      const values = readColumn(r, type.inner, rows, innerState(state), ctx);
      for (let i = 0; i < rows; i++) {
        if (nulls[i] !== 0) values[i] = null;
      }
      return values;
    }
    case "LowCardinality":
      return readLowCardinality(r, type, rows, ctx);
    case "Array": {
      const offsets = readOffsets(r, rows);
      const total = offsets[rows - 1] ?? 0;
      const values = readColumn(r, type.inner, total, innerState(state), ctx);
      const out = new Array<unknown[]>(rows);
      let start = 0;
      for (let i = 0; i < rows; i++) {
        const end = offsets[i] as number;
        out[i] = values.slice(start, end);
        start = end;
      }
      return out;
    }
    case "Map": {
      const offsets = readOffsets(r, rows);
      const total = offsets[rows - 1] ?? 0;
      const states = elementStates(state, 2);
      const keys = readColumn(r, type.key, total, states[0], ctx);
      const values = readColumn(r, type.value, total, states[1], ctx);
      const out = new Array<Array<[unknown, unknown]>>(rows);
      let start = 0;
      for (let i = 0; i < rows; i++) {
        const end = offsets[i] as number;
        const pairs: Array<[unknown, unknown]> = [];
        for (let j = start; j < end; j++) pairs.push([keys[j], values[j]]);
        out[i] = pairs;
        start = end;
      }
      return out;
    }
    case "Tuple": {
      if (type.elements.length === 0) {
        // The server writes one byte for each row of an empty tuple.
        r.skip(rows);
        const empty = new Array<unknown[]>(rows);
        for (let i = 0; i < rows; i++) empty[i] = [];
        return empty;
      }
      const states = elementStates(state, type.elements.length);
      const columns = type.elements.map((element, i) =>
        readColumn(r, element, rows, states[i], ctx),
      );
      const out = new Array<unknown[]>(rows);
      for (let i = 0; i < rows; i++) {
        out[i] = columns.map((column) => column[i]);
      }
      return out;
    }
    case "Variant":
      return readVariant(r, type, rows, state, ctx);
    case "Dynamic":
      return readDynamic(r, rows, state, ctx);
    case "JSON":
      return readJSON(r, type, rows, state, ctx);
    case "SharedVariant": {
      const out = new Array<unknown>(rows);
      for (let i = 0; i < rows; i++) {
        const bytes = r.bytes();
        out[i] = readBinaryTypedValue(bytes, ctx);
      }
      return out;
    }
    case "Unsupported":
      throw new ProtocolError(
        `The client cannot decode columns of type ${type.name}`,
      );
  }
}

function innerState(state: State): State {
  return state !== undefined && state.s === "inner" ? state.inner : undefined;
}

function elementStates(state: State, count: number): State[] {
  if (state !== undefined && state.s === "elements") return state.elements;
  return new Array<State>(count).fill(undefined);
}

function readOffsets(r: BinaryReader, rows: number): number[] {
  const offsets = new Array<number>(rows);
  for (let i = 0; i < rows; i++) offsets[i] = r.u64n();
  return offsets;
}

const TWO_64 = 1n << 64n;

function readInts(
  r: BinaryReader,
  bits: 8 | 16 | 32 | 64 | 128 | 256,
  signed: boolean,
  rows: number,
): Array<number | bigint> {
  const out = new Array<number | bigint>(rows);
  const size = bits / 8;
  r.ensure(rows * size);
  const buf = r.buf;
  switch (bits) {
    case 8:
      for (let i = 0; i < rows; i++, r.pos++)
        out[i] = signed ? buf.readInt8(r.pos) : (buf[r.pos] as number);
      break;
    case 16:
      for (let i = 0; i < rows; i++, r.pos += 2)
        out[i] = signed ? buf.readInt16LE(r.pos) : buf.readUInt16LE(r.pos);
      break;
    case 32:
      for (let i = 0; i < rows; i++, r.pos += 4)
        out[i] = signed ? buf.readInt32LE(r.pos) : buf.readUInt32LE(r.pos);
      break;
    case 64: {
      const view = new DataView(buf.buffer, buf.byteOffset + r.pos, rows * 8);
      if (signed) {
        for (let i = 0; i < rows; i++) out[i] = view.getBigInt64(i * 8, true);
      } else {
        for (let i = 0; i < rows; i++) out[i] = view.getBigUint64(i * 8, true);
      }
      r.pos += rows * 8;
      break;
    }
    default: {
      const words = bits / 64;
      const limit = 1n << BigInt(bits);
      const signBit = 1n << BigInt(bits - 1);
      for (let i = 0; i < rows; i++) {
        let v = 0n;
        for (let w = words - 1; w >= 0; w--) {
          v = v * TWO_64 + buf.readBigUInt64LE(r.pos + w * 8);
        }
        if (signed && v >= signBit) v -= limit;
        out[i] = v;
        r.pos += size;
      }
    }
  }
  return out;
}

const LC_KEY_TYPE_MASK = 0xff;
const LC_HAS_ADDITIONAL_KEYS = 1 << 9;
const LC_NEED_GLOBAL_DICTIONARY = 1 << 8;

function readLowCardinality(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "LowCardinality" }>,
  rows: number,
  ctx: DecodeContext,
): unknown[] {
  const nullable = type.inner.kind === "Nullable";
  const dictionaryType = nullable
    ? (type.inner as Extract<ColumnType, { kind: "Nullable" }>).inner
    : type.inner;
  const out: unknown[] = [];
  let keys: unknown[] = [];
  while (out.length < rows) {
    const flags = Number(r.u64());
    if ((flags & LC_NEED_GLOBAL_DICTIONARY) !== 0) {
      throw new ProtocolError(
        "LowCardinality with a global dictionary is not supported",
      );
    }
    if ((flags & LC_HAS_ADDITIONAL_KEYS) !== 0) {
      const count = r.u64n();
      keys = readColumn(r, dictionaryType, count, undefined, ctx);
    }
    const count = r.u64n();
    const indexes = readInts(
      r,
      (8 << (flags & LC_KEY_TYPE_MASK)) as 8 | 16 | 32 | 64,
      false,
      count,
    );
    for (const index of indexes) {
      const i = Number(index);
      out.push(nullable && i === 0 ? null : keys[i]);
    }
    if (count === 0) break;
  }
  return out;
}

const NULL_DISCRIMINATOR = 255;

function readVariant(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "Variant" }>,
  rows: number,
  state: State,
  ctx: DecodeContext,
): unknown[] {
  if (state === undefined || state.s !== "variant") {
    throw new ProtocolError("Missing state prefix of a Variant column");
  }
  const discriminators = new Uint8Array(rows);
  if (!state.compact) {
    discriminators.set(r.fixed(rows));
  } else {
    let filled = 0;
    while (filled < rows) {
      const granule = r.varuint();
      const format = r.u8();
      const n = Math.min(granule, rows - filled);
      if (format === 1) {
        discriminators.fill(r.u8(), filled, filled + n);
      } else {
        discriminators.set(r.fixed(n), filled);
      }
      filled += n;
      if (granule === 0) break;
    }
  }
  const counts = new Array<number>(type.variants.length).fill(0);
  for (const d of discriminators) {
    if (d !== NULL_DISCRIMINATOR) {
      if (d >= counts.length) {
        throw new ProtocolError(`Unknown Variant discriminator ${d}`);
      }
      counts[d]!++;
    }
  }
  const columns = type.variants.map((variant, i) =>
    readColumn(r, variant, counts[i] as number, state.variants[i], ctx),
  );
  const positions = new Array<number>(type.variants.length).fill(0);
  const out = new Array<unknown>(rows);
  for (let i = 0; i < rows; i++) {
    const d = discriminators[i] as number;
    if (d === NULL_DISCRIMINATOR) {
      out[i] = null;
    } else {
      const value = (columns[d] as unknown[])[positions[d]!++];
      const variant = type.variants[d] as ColumnType;
      // A value of the shared variant of a Dynamic column is already typed.
      out[i] =
        variant.kind === "SharedVariant"
          ? value
          : new TypedValue(variant, value);
    }
  }
  return out;
}

function readDynamic(
  r: BinaryReader,
  rows: number,
  state: State,
  ctx: DecodeContext,
): unknown[] {
  if (state === undefined || state.s !== "dynamic") {
    throw new ProtocolError("Missing state prefix of a Dynamic column");
  }
  if (!state.flattened) {
    return readVariant(r, state.variant, rows, state.state, ctx);
  }
  const count = state.types.length;
  // The index type is the smallest unsigned type that can hold `count`;
  // the index `count` is NULL.
  const bits = count <= 0xff ? 8 : count <= 0xffff ? 16 : 32;
  const indexes = readInts(r, bits, false, rows) as number[];
  const counts = new Array<number>(count).fill(0);
  for (const index of indexes) {
    if (index < count) counts[index]!++;
  }
  const columns = state.types.map((type, i) =>
    readColumn(r, type, counts[i] as number, state.states[i], ctx),
  );
  const positions = new Array<number>(count).fill(0);
  const out = new Array<unknown>(rows);
  for (let i = 0; i < rows; i++) {
    const index = indexes[i] as number;
    out[i] =
      index >= count
        ? null
        : new TypedValue(
            state.types[index] as ColumnType,
            (columns[index] as unknown[])[positions[index]!++],
          );
  }
  return out;
}

const DYNAMIC_TYPE: ColumnType = { kind: "Dynamic", name: "Dynamic" };

function readJSON(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "JSON" }>,
  rows: number,
  state: State,
  ctx: DecodeContext,
): unknown[] {
  if (state === undefined) {
    throw new ProtocolError("Missing state prefix of a JSON column");
  }
  if (state.s === "json_string") {
    const out = new Array<RawJSONValue>(rows);
    for (let i = 0; i < rows; i++) {
      out[i] = new RawJSONValue(readString(r, ctx));
    }
    return out;
  }
  if (state.s !== "json_flattened" && state.s !== "json_paths") {
    throw new ProtocolError("Unexpected state prefix of a JSON column");
  }
  const objects: Array<Array<[string, ColumnType, unknown]>> = [];
  for (let i = 0; i < rows; i++) objects.push([]);

  type.typed_paths.forEach(([path, pathType], p) => {
    const values = readColumn(r, pathType, rows, state.typed[p], ctx);
    for (let i = 0; i < rows; i++) {
      objects[i]!.push([path, pathType, values[i]]);
    }
  });
  const dynamicPaths =
    state.s === "json_flattened" ? state.paths : state.dynamic_paths;
  dynamicPaths.forEach((path, p) => {
    const values = readDynamic(r, rows, state.dynamic[p], ctx);
    for (let i = 0; i < rows; i++) {
      const value = values[i];
      if (value !== null) objects[i]!.push([path, DYNAMIC_TYPE, value]);
    }
  });
  if (state.s === "json_paths") {
    // Shared data: Array(Tuple(path String, value String)), where each value
    // is a binary type and a value.
    const offsets = readOffsets(r, rows);
    const total = offsets[rows - 1] ?? 0;
    const paths = readColumn(
      r,
      { kind: "String", name: "String" },
      total,
      undefined,
      ctx,
    ) as string[];
    const values: unknown[] = [];
    for (let i = 0; i < total; i++)
      values.push(readBinaryTypedValue(r.bytes(), ctx));
    let start = 0;
    for (let i = 0; i < rows; i++) {
      const end = offsets[i] as number;
      for (let j = start; j < end; j++) {
        if (values[j] !== null) {
          objects[i]!.push([paths[j] as string, DYNAMIC_TYPE, values[j]]);
        }
      }
      start = end;
    }
  }
  return objects.map((paths) => {
    paths.sort(([a], [b]) => compareBytes(a, b));
    return new JSONObjectValue(paths);
  });
}

/** Decodes a value that has its type in the binary type encoding before it
 *  (the shared variant of `Dynamic`, the shared data of `JSON`). */
function readBinaryTypedValue(
  bytes: Buffer,
  ctx: DecodeContext,
): TypedValue | null {
  const r = new BinaryReader(bytes);
  const type = readBinaryType(r);
  if (type.kind === "Nothing") return null;
  return new TypedValue(type, readRowValue(r, type, ctx));
}

/** Reads one value in the RowBinary encoding. */
export function readRowValue(
  r: BinaryReader,
  type: ColumnType,
  ctx: DecodeContext,
): unknown {
  switch (type.kind) {
    case "Nullable":
      return r.u8() !== 0 ? null : readRowValue(r, type.inner, ctx);
    case "LowCardinality":
      return readRowValue(r, type.inner, ctx);
    case "Array": {
      const n = r.varuint();
      const out: unknown[] = [];
      for (let i = 0; i < n; i++) out.push(readRowValue(r, type.inner, ctx));
      return out;
    }
    case "Map": {
      const n = r.varuint();
      const out: Array<[unknown, unknown]> = [];
      for (let i = 0; i < n; i++) {
        const key = readRowValue(r, type.key, ctx);
        out.push([key, readRowValue(r, type.value, ctx)]);
      }
      return out;
    }
    case "Tuple":
      return type.elements.map((element) => readRowValue(r, element, ctx));
    case "Variant": {
      const d = r.u8();
      if (d === NULL_DISCRIMINATOR) return null;
      const variant = type.variants[d];
      if (variant === undefined) {
        throw new ProtocolError(`Unknown Variant discriminator ${d}`);
      }
      return new TypedValue(variant, readRowValue(r, variant, ctx));
    }
    case "Dynamic": {
      const valueType = readBinaryType(r);
      if (valueType.kind === "Nothing") return null;
      return new TypedValue(valueType, readRowValue(r, valueType, ctx));
    }
    case "JSON": {
      const n = r.varuint();
      const paths: Array<[string, ColumnType, unknown]> = [];
      const typed = new Map(type.typed_paths);
      for (let i = 0; i < n; i++) {
        const path = r.string();
        const pathType = typed.get(path);
        if (pathType !== undefined) {
          paths.push([path, pathType, readRowValue(r, pathType, ctx)]);
        } else {
          const value = readRowValue(r, DYNAMIC_TYPE, ctx);
          if (value !== null) paths.push([path, DYNAMIC_TYPE, value]);
        }
      }
      paths.sort(([a], [b]) => compareBytes(a, b));
      return new JSONObjectValue(paths);
    }
    case "Nothing":
      return null;
    case "String":
      return readString(r, ctx);
    default:
      // Fixed-size types are the same in RowBinary and in Native.
      return readColumn(r, type, 1, undefined, ctx)[0];
  }
}
