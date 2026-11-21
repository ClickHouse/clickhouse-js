import { constants, isAscii, isUtf8 } from "node:buffer";
import { BinaryReader, ProtocolError } from "./binary";
import { readBinaryType } from "./binary_types";
import type { Column } from "./packets";
import type { ColumnType } from "./types";
import { compareBytes, parseColumnType } from "./types";
import type { DateTimeOutputFormat } from "./text";
import {
  createDateTimeFormatter,
  formatDate,
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

/** Columnar storage shared by all rows of one decoded `JSON` block, avoiding
 *  per-cell `[path, type, value]` tuple and `TypedValue` allocations. */
export interface JSONColumnarBlock {
  /** Pre-sorted paths (UTF-8 byte order). */
  readonly paths: string[];
  /** Pre-split path segments (`undefined` when the path has no `.`). */
  readonly segments: Array<string[] | undefined>;
  /** Column type for each path (concrete type when uniform, or `Dynamic`). */
  readonly types: ColumnType[];
  /** Decoded column values (length = rows) for each path. */
  readonly values: unknown[][];
  /** `1` if `null` values in that column are omitted (dynamic paths), `0` for typed paths. */
  readonly skipNull: Uint8Array;
  /** Per-row shared data (only allocated when shared data total > 0). */
  readonly shared:
    Array<Array<[string, ColumnType, unknown]> | undefined> | undefined;
}

function materializeJSONRow(
  block: JSONColumnarBlock,
  row: number,
): Array<[path: string, type: ColumnType, value: unknown]> {
  const out: Array<[string, ColumnType, unknown]> = [];
  const colCount = block.paths.length;
  for (let c = 0; c < colCount; c++) {
    const value = block.values[c]![row];
    if (block.skipNull[c] === 1 && value === null) continue;
    out.push([block.paths[c]!, block.types[c]!, value]);
  }
  const extra = block.shared?.[row];
  if (extra !== undefined) {
    for (const entry of extra) {
      out.push(entry);
    }
    out.sort(([a], [b]) => compareBytes(a, b));
  }
  return out;
}

/** A `JSON` value that the server sent as paths. Only the paths with values
 *  are in `paths`; `null` values of dynamic paths are left out. */
export class JSONObjectValue {
  private _paths:
    Array<[path: string, type: ColumnType, value: unknown]> | undefined;
  readonly block: JSONColumnarBlock | undefined;
  readonly row: number;

  constructor(
    pathsOrBlock: Array<[string, ColumnType, unknown]> | JSONColumnarBlock,
    row = 0,
  ) {
    if (Array.isArray(pathsOrBlock)) {
      this._paths = pathsOrBlock;
      this.block = undefined;
      this.row = 0;
    } else {
      this._paths = undefined;
      this.block = pathsOrBlock;
      this.row = row;
    }
  }

  get paths(): Array<[path: string, type: ColumnType, value: unknown]> {
    if (this._paths === undefined) {
      this._paths = materializeJSONRow(this.block!, this.row);
    }
    return this._paths;
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
  /** Decode 64-bit integers that fit in JS safe integers as `number` instead
   *  of heap-allocated `bigint` (all client formatters accept `number | bigint`). */
  safe_int64?: boolean;
  /** True when the caller (NativeSocket) consumes already-decompressed
   *  compressed frames from its receive buffer incrementally via
   *  `NeedMoreData.consumed`. */
  consume_frames?: boolean;
  /** The packet that is not complete yet. The packet reader keeps the
   *  columns that it decoded, and continues after them when more data
   *  comes. */
  pending?: PendingPacket;
}

/** The state of a block that the reader decoded only in part. */
export interface PendingBlock {
  /** The decoded columns, or `undefined` before the block header is read. */
  columns?: Column[];
  /** Number of columns already skipped (used when discarding Log blocks). */
  skipped?: number;
  column_count: number;
  rows: number;
  /** The offset after the last decoded column, from the start of the block. */
  offset: number;
  /** Bytes already consumed from the decompressed buffer for earlier columns. */
  bytes?: number;
}

/** The state of a packet that the reader decoded only in part. */
export interface PendingPacket {
  /** Set when a compressed Data/Totals/Extremes packet's header and earlier
   *  frames were already consumed from the receive buffer. */
  packet_type?: number;
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
    let byteCount = 0;
    for (;;) {
      // Each of the next rows needs one byte or more.
      if (pos >= limit) r.ensure(pos - r.pos + rows - i);
      const byte = buf[pos++] as number;
      len += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (len > Number.MAX_SAFE_INTEGER) {
          throw new ProtocolError("A VarUInt value is too large");
        }
        break;
      }
      short = false;
      byteCount++;
      if (byteCount >= 10) {
        throw new ProtocolError("A VarUInt value is longer than 10 bytes");
      }
      multiplier *= 128;
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
  if (rows === 0) return [];
  if (rows === 1) return [readString(r, ctx)];
  const scanned = scanStringColumn(r, rows);
  return decodeScannedStrings(r, rows, scanned, ctx, true);
}

/** Decodes a String column whose bounds were already found by
 *  {@link scanStringColumn}, avoiding repeated VarUInt or ASCII scans. */
function decodeScannedStrings(
  r: BinaryReader,
  rows: number,
  scanned: { end: number; short: boolean },
  ctx: DecodeContext,
  checkAscii: boolean,
): string[] {
  const buf = r.buf;
  const start = r.pos;
  const end = scanned.end;
  const out = new Array<string>(rows);
  if (scanned.short) {
    if (
      checkAscii &&
      rows > 1 &&
      end - start <= constants.MAX_STRING_LENGTH &&
      isAscii(buf.subarray(start, end))
    ) {
      // Each length prefix fits in one byte, so its byte offset is also its
      // offset in the decoded string. Decode the entire column once.
      const ascii = buf.toString("latin1", start, end);
      let offset = 0;
      for (let i = 0; i < rows; i++) {
        const len = ascii.charCodeAt(offset++);
        out[i] = ascii.slice(offset, offset + len);
        offset += len;
      }
      r.pos = end;
      return out;
    }
    // Every length prefix is guaranteed to fit in 1 byte: skip VarUInt loop.
    let pos = start;
    for (let i = 0; i < rows; i++) {
      const len = buf[pos++] as number;
      out[i] = decodeString(buf, pos, pos + len, ctx);
      pos += len;
    }
    r.pos = end;
    return out;
  }
  for (let i = 0; i < rows; i++) out[i] = readString(r, ctx);
  return out;
}

/** Keeps a column whose bytes can be used directly by the JSON row writer, or
 *  returns decoded values directly when a String column was already scanned
 *  and cannot stay in binary form. */
export function readBinaryColumn(
  r: BinaryReader,
  type: ColumnType,
  rows: number,
  ctx: DecodeContext,
): { binary: Buffer } | { values: unknown[] } | undefined {
  const start = r.pos;
  let end: number;
  if (type.kind === "String") {
    const strings = scanStringColumn(r, rows);
    end = strings.end;
    // Each one-byte length is ASCII. It prevents an incomplete UTF-8
    // sequence at the end of one value from continuing into the next.
    if (!strings.short) {
      return { values: decodeScannedStrings(r, rows, strings, ctx, false) };
    }
    if (!isUtf8(r.buf.subarray(start, end))) {
      // Invalid UTF-8 cannot be ASCII either: skip the isAscii check.
      return { values: decodeScannedStrings(r, rows, strings, ctx, false) };
    }
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
  return { binary: Buffer.from(r.buf.subarray(start, end)) };
}

function readEnums(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "Enum" }>,
  rows: number,
  nulls: Buffer | undefined,
  firstIsNull = false,
): Array<string | null> {
  const out = new Array<string | null>(rows);
  const size = type.bits / 8;
  r.ensure(rows * size);
  for (let i = 0; i < rows; i++, r.pos += size) {
    if ((firstIsNull && i === 0) || (nulls !== undefined && nulls[i] !== 0)) {
      // A NULL row (or slot 0 of LowCardinality(Nullable(Enum))) can hold a
      // number that is not a value of the Enum.
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
      return readInts(r, type.bits, type.signed, rows, ctx.safe_int64);
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
      const format = createDateTimeFormatter(
        type.timezone ?? ctx.timezone,
        ctx.date_time_output_format,
      );
      const out = new Array<string>(rows);
      r.ensure(rows * 4);
      const buf = r.buf;
      let pos = r.pos;
      for (let i = 0; i < rows; i++, pos += 4) {
        out[i] = format(buf.readUInt32LE(pos));
      }
      r.pos = pos;
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
      const width = columns.length;
      const out = new Array<unknown[]>(rows);
      for (let i = 0; i < rows; i++) {
        const tuple = new Array<unknown>(width);
        for (let j = 0; j < width; j++) {
          tuple[j] = (columns[j] as unknown[])[i];
        }
        out[i] = tuple;
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
  let prev = 0;
  for (let i = 0; i < rows; i++) {
    const offset = r.u64n();
    if (offset < prev) {
      throw new ProtocolError(
        `Non-monotonic offset ${offset} after ${prev} at row ${i}`,
      );
    }
    offsets[i] = offset;
    prev = offset;
  }
  return offsets;
}

const TWO_64 = 1n << 64n;

function readInts(
  r: BinaryReader,
  bits: 8 | 16 | 32 | 64 | 128 | 256,
  signed: boolean,
  rows: number,
  safeInt64 = false,
): Array<number | bigint> {
  const out = new Array<number | bigint>(rows);
  const size = bits / 8;
  r.ensure(rows * size);
  const buf = r.buf;
  switch (bits) {
    case 8: {
      let pos = r.pos;
      if (signed) {
        for (let i = 0; i < rows; i++, pos++) out[i] = buf.readInt8(pos);
      } else {
        for (let i = 0; i < rows; i++, pos++) out[i] = buf[pos] as number;
      }
      r.pos = pos;
      break;
    }
    case 16: {
      let pos = r.pos;
      if (signed) {
        for (let i = 0; i < rows; i++, pos += 2) out[i] = buf.readInt16LE(pos);
      } else {
        for (let i = 0; i < rows; i++, pos += 2) out[i] = buf.readUInt16LE(pos);
      }
      r.pos = pos;
      break;
    }
    case 32: {
      let pos = r.pos;
      if (signed) {
        for (let i = 0; i < rows; i++, pos += 4) out[i] = buf.readInt32LE(pos);
      } else {
        for (let i = 0; i < rows; i++, pos += 4) out[i] = buf.readUInt32LE(pos);
      }
      r.pos = pos;
      break;
    }
    case 64: {
      const view = new DataView(buf.buffer, buf.byteOffset + r.pos, rows * 8);
      if (safeInt64) {
        if (signed) {
          for (let i = 0; i < rows; i++) {
            const offset = i * 8;
            const hi = view.getInt32(offset + 4, true);
            if (hi >= -0x1fffff && hi <= 0x1fffff) {
              out[i] = hi * 0x100000000 + view.getUint32(offset, true);
            } else {
              out[i] = view.getBigInt64(offset, true);
            }
          }
        } else {
          for (let i = 0; i < rows; i++) {
            const offset = i * 8;
            const hi = view.getUint32(offset + 4, true);
            if (hi <= 0x1fffff) {
              out[i] = hi * 0x100000000 + view.getUint32(offset, true);
            } else {
              out[i] = view.getBigUint64(offset, true);
            }
          }
        }
      } else if (signed) {
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
    const keyType = flags & LC_KEY_TYPE_MASK;
    if (keyType > 3) {
      throw new ProtocolError(`Unknown LowCardinality index type ${keyType}`);
    }
    if ((flags & LC_HAS_ADDITIONAL_KEYS) !== 0) {
      const dictCount = r.u64n();
      keys =
        nullable && dictionaryType.kind === "Enum"
          ? readEnums(r, dictionaryType, dictCount, undefined, true)
          : readColumn(r, dictionaryType, dictCount, undefined, ctx);
    }
    const count = r.u64n();
    if (count === 0) {
      throw new ProtocolError(
        `LowCardinality column ended early (${out.length} of ${rows} rows)`,
      );
    }
    if (out.length + count > rows) {
      throw new ProtocolError(
        `LowCardinality column has too many rows (${out.length + count} > ${rows})`,
      );
    }
    const indexes = readInts(
      r,
      (8 << keyType) as 8 | 16 | 32 | 64,
      false,
      count,
      true,
    );
    for (let j = 0; j < count; j++) {
      const i = Number(indexes[j]);
      if (nullable && i === 0) {
        out.push(null);
      } else {
        if (i >= keys.length) {
          throw new ProtocolError(
            `LowCardinality index ${i} out of bounds for dictionary of size ${keys.length}`,
          );
        }
        out.push(keys[i]);
      }
    }
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
      if (granule === 0) {
        throw new ProtocolError(
          `Variant compact discriminators ended early (${filled} of ${rows} rows)`,
        );
      }
      if (granule > rows - filled) {
        throw new ProtocolError(
          `Variant compact discriminator granule size ${granule} exceeds remaining rows ${rows - filled}`,
        );
      }
      if (format === 1) {
        discriminators.fill(r.u8(), filled, filled + granule);
      } else if (format === 0) {
        discriminators.set(r.fixed(granule), filled);
      } else {
        throw new ProtocolError(
          `Unknown Variant compact discriminator format ${format}`,
        );
      }
      filled += granule;
    }
  }
  const counts = new Array<number>(type.variants.length).fill(0);
  const variantCount = counts.length;
  for (let i = 0; i < rows; i++) {
    const d = discriminators[i] as number;
    if (d !== NULL_DISCRIMINATOR) {
      if (d >= variantCount) {
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
  for (let i = 0; i < rows; i++) {
    const index = indexes[i] as number;
    if (index < count) {
      counts[index]!++;
    } else if (index > count) {
      throw new ProtocolError(
        `Unknown Dynamic type index ${index} (expected at most ${count})`,
      );
    }
  }
  const columns = state.types.map((type, i) =>
    readColumn(r, type, counts[i] as number, state.states[i], ctx),
  );
  const positions = new Array<number>(count).fill(0);
  const out = new Array<unknown>(rows);
  for (let i = 0; i < rows; i++) {
    const index = indexes[i] as number;
    out[i] =
      index === count
        ? null
        : new TypedValue(
            state.types[index] as ColumnType,
            (columns[index] as unknown[])[positions[index]!++],
          );
  }
  return out;
}

const DYNAMIC_TYPE: ColumnType = { kind: "Dynamic", name: "Dynamic" };

/** Decodes a `Variant` column into either a single concrete type (skipping
 *  per-row `TypedValue` wrappers when only one variant is active) or a
 *  per-row `TypedValue` array. */
function readVariantColumnar(
  r: BinaryReader,
  type: Extract<ColumnType, { kind: "Variant" }>,
  rows: number,
  state: State,
  ctx: DecodeContext,
): { type: ColumnType; values: unknown[] } {
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
      if (granule === 0) {
        throw new ProtocolError(
          `Variant compact discriminators ended early (${filled} of ${rows} rows)`,
        );
      }
      if (granule > rows - filled) {
        throw new ProtocolError(
          `Variant compact discriminator granule size ${granule} exceeds remaining rows ${rows - filled}`,
        );
      }
      if (format === 1) {
        discriminators.fill(r.u8(), filled, filled + granule);
      } else if (format === 0) {
        discriminators.set(r.fixed(granule), filled);
      } else {
        throw new ProtocolError(
          `Unknown Variant compact discriminator format ${format}`,
        );
      }
      filled += granule;
    }
  }
  const counts = new Array<number>(type.variants.length).fill(0);
  const variantCount = counts.length;
  for (let i = 0; i < rows; i++) {
    const d = discriminators[i] as number;
    if (d !== NULL_DISCRIMINATOR) {
      if (d >= variantCount) {
        throw new ProtocolError(`Unknown Variant discriminator ${d}`);
      }
      counts[d]!++;
    }
  }
  const columns = type.variants.map((variant, i) =>
    readColumn(r, variant, counts[i] as number, state.variants[i], ctx),
  );
  let activeCount = 0;
  let singleD = -1;
  for (let d = 0; d < counts.length; d++) {
    if (counts[d]! > 0) {
      activeCount++;
      singleD = d;
    }
  }
  if (activeCount === 0) {
    return { type: DYNAMIC_TYPE, values: new Array<null>(rows).fill(null) };
  }
  if (activeCount === 1) {
    const variant = type.variants[singleD]!;
    if (variant.kind !== "SharedVariant") {
      if (counts[singleD] === rows) {
        return { type: variant, values: columns[singleD]! };
      }
      const col = columns[singleD]!;
      const out = new Array<unknown>(rows);
      let pos = 0;
      for (let i = 0; i < rows; i++) {
        out[i] = discriminators[i] === NULL_DISCRIMINATOR ? null : col[pos++];
      }
      return { type: variant, values: out };
    }
  }
  const positions = new Array<number>(type.variants.length).fill(0);
  const out = new Array<unknown>(rows);
  for (let i = 0; i < rows; i++) {
    const d = discriminators[i] as number;
    if (d === NULL_DISCRIMINATOR) {
      out[i] = null;
    } else {
      const value = (columns[d] as unknown[])[positions[d]!++];
      const variant = type.variants[d] as ColumnType;
      out[i] =
        variant.kind === "SharedVariant"
          ? value
          : new TypedValue(variant, value);
    }
  }
  return { type: DYNAMIC_TYPE, values: out };
}

/** Decodes a `Dynamic` column inside `JSON`, returning a concrete column type
 *  without `TypedValue` wrappers when all non-null rows share one type. */
function readDynamicColumnar(
  r: BinaryReader,
  rows: number,
  state: State,
  ctx: DecodeContext,
): { type: ColumnType; values: unknown[] } {
  if (state === undefined || state.s !== "dynamic") {
    throw new ProtocolError("Missing state prefix of a Dynamic column");
  }
  if (!state.flattened) {
    return readVariantColumnar(r, state.variant, rows, state.state, ctx);
  }
  const count = state.types.length;
  const bits = count <= 0xff ? 8 : count <= 0xffff ? 16 : 32;
  const indexes = readInts(r, bits, false, rows) as number[];
  const counts = new Array<number>(count).fill(0);
  for (let i = 0; i < rows; i++) {
    const index = indexes[i] as number;
    if (index < count) {
      counts[index]!++;
    } else if (index > count) {
      throw new ProtocolError(
        `Unknown Dynamic type index ${index} (expected at most ${count})`,
      );
    }
  }
  const columns = state.types.map((type, i) =>
    readColumn(r, type, counts[i] as number, state.states[i], ctx),
  );
  let activeCount = 0;
  let singleIdx = -1;
  for (let i = 0; i < count; i++) {
    if (counts[i]! > 0) {
      activeCount++;
      singleIdx = i;
    }
  }
  if (activeCount === 0) {
    return { type: DYNAMIC_TYPE, values: new Array<null>(rows).fill(null) };
  }
  if (activeCount === 1) {
    const singleType = state.types[singleIdx]!;
    if (counts[singleIdx] === rows) {
      return { type: singleType, values: columns[singleIdx]! };
    }
    const col = columns[singleIdx]!;
    const out = new Array<unknown>(rows);
    let pos = 0;
    for (let i = 0; i < rows; i++) {
      out[i] = indexes[i] === count ? null : col[pos++];
    }
    return { type: singleType, values: out };
  }
  const positions = new Array<number>(count).fill(0);
  const out = new Array<unknown>(rows);
  for (let i = 0; i < rows; i++) {
    const index = indexes[i] as number;
    out[i] =
      index === count
        ? null
        : new TypedValue(
            state.types[index] as ColumnType,
            (columns[index] as unknown[])[positions[index]!++],
          );
  }
  return { type: DYNAMIC_TYPE, values: out };
}

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
    const texts = readStrings(r, rows, ctx);
    const out = new Array<RawJSONValue>(rows);
    for (let i = 0; i < rows; i++) {
      out[i] = new RawJSONValue(texts[i]!);
    }
    return out;
  }
  if (state.s !== "json_flattened" && state.s !== "json_paths") {
    throw new ProtocolError("Unexpected state prefix of a JSON column");
  }
  const cols: Array<{
    path: string;
    type: ColumnType;
    values: unknown[];
    skipNull: boolean;
  }> = [];

  type.typed_paths.forEach(([path, pathType], p) => {
    cols.push({
      path,
      type: pathType,
      values: readColumn(r, pathType, rows, state.typed[p], ctx),
      skipNull: false,
    });
  });
  const dynamicPaths =
    state.s === "json_flattened" ? state.paths : state.dynamic_paths;
  dynamicPaths.forEach((path, p) => {
    const decoded = readDynamicColumnar(r, rows, state.dynamic[p], ctx);
    cols.push({
      path,
      type: decoded.type,
      values: decoded.values,
      skipNull: true,
    });
  });
  // Pre-sort fixed typed + dynamic columns once per block.
  cols.sort((a, b) => compareBytes(a.path, b.path));

  const colCount = cols.length;
  const colPaths = new Array<string>(colCount);
  const colSegments = new Array<string[] | undefined>(colCount);
  const colTypes = new Array<ColumnType>(colCount);
  const colValues = new Array<unknown[]>(colCount);
  const colSkipNull = new Uint8Array(colCount);
  for (let c = 0; c < colCount; c++) {
    const col = cols[c]!;
    colPaths[c] = col.path;
    colSegments[c] = col.path.includes(".") ? col.path.split(".") : undefined;
    colTypes[c] = col.type;
    colValues[c] = col.values;
    colSkipNull[c] = col.skipNull ? 1 : 0;
  }

  let shared:
    Array<Array<[string, ColumnType, unknown]> | undefined> | undefined;
  if (state.s === "json_paths") {
    // Shared data: Array(Tuple(path String, value String)), where each value
    // is a binary type and a value.
    const offsets = readOffsets(r, rows);
    const total = offsets[rows - 1] ?? 0;
    if (total > 0) {
      shared = new Array<Array<[string, ColumnType, unknown]> | undefined>(
        rows,
      );
      const paths = readColumn(
        r,
        { kind: "String", name: "String" },
        total,
        undefined,
        ctx,
      ) as string[];
      const values = new Array<unknown>(total);
      for (let i = 0; i < total; i++) {
        values[i] = readBinaryTypedValue(r.bytes(), ctx);
      }
      let start = 0;
      for (let i = 0; i < rows; i++) {
        const end = offsets[i] as number;
        if (end > start) {
          let rowShared: Array<[string, ColumnType, unknown]> | undefined;
          for (let j = start; j < end; j++) {
            if (values[j] !== null) {
              rowShared ??= [];
              rowShared.push([paths[j] as string, DYNAMIC_TYPE, values[j]]);
            }
          }
          if (rowShared !== undefined) shared[i] = rowShared;
        }
        start = end;
      }
    }
  }

  const block: JSONColumnarBlock = {
    paths: colPaths,
    segments: colSegments,
    types: colTypes,
    values: colValues,
    skipNull: colSkipNull,
    shared,
  };
  const out = new Array<JSONObjectValue>(rows);
  for (let i = 0; i < rows; i++) {
    out[i] = new JSONObjectValue(block, i);
  }
  return out;
}

/** Advances `r` past a column without decoding its values (used to discard
 *  `ServerPacketType.Log` blocks cheaply). Falls back to {@link readColumn}
 *  for complex types. */
export function skipColumn(
  r: BinaryReader,
  type: ColumnType,
  rows: number,
  state: State,
  ctx: DecodeContext,
): void {
  if (rows === 0) return;
  switch (type.kind) {
    case "Int":
    case "Float":
    case "Enum":
      r.skip(rows * (type.bits / 8));
      return;
    case "BFloat16":
    case "Date":
      r.skip(rows * 2);
      return;
    case "Bool":
    case "Nothing":
      r.skip(rows);
      return;
    case "Decimal":
      r.skip(rows * type.bytes);
      return;
    case "FixedString":
      r.skip(rows * type.size);
      return;
    case "Date32":
    case "DateTime":
    case "Time":
    case "IPv4":
      r.skip(rows * 4);
      return;
    case "DateTime64":
    case "Time64":
      r.skip(rows * 8);
      return;
    case "UUID":
    case "IPv6":
      r.skip(rows * 16);
      return;
    case "String":
      r.pos = scanStringColumn(r, rows).end;
      return;
    case "Nullable":
      r.skip(rows);
      skipColumn(r, type.inner, rows, innerState(state), ctx);
      return;
    case "Array": {
      const offsets = readOffsets(r, rows);
      skipColumn(r, type.inner, offsets[rows - 1] ?? 0, innerState(state), ctx);
      return;
    }
    default:
      readColumn(r, type, rows, state, ctx);
  }
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
