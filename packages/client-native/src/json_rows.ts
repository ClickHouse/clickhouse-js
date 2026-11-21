import type { Block, Column } from "./protocol/packets";
import type { ColumnType } from "./protocol/types";

type Escapes = ReadonlyArray<Buffer | undefined>;

const MAX_BUFFER_SIZE = 16 * 1024 * 1024;
/** Reusable synchronous scratch buffer kept across queries up to this size. */
const MAX_KEPT_SCRATCH_SIZE = 8 * 1024 * 1024;
let sharedScratch: Buffer | undefined;
const TRUE = Buffer.from("true");
const FALSE = Buffer.from("false");
const LINE_SEPARATOR = Buffer.from("\\u2028");
const PARAGRAPH_SEPARATOR = Buffer.from("\\u2029");
const DIGIT_PAIRS = Uint8Array.from(
  { length: 200 },
  (_, i) => 48 + (i % 2 === 0 ? Math.floor(i / 20) : Math.floor(i / 2) % 10),
);

const FIELD_STRING = 0;
const FIELD_BOOL = 1;
const FIELD_INT8 = 2;
const FIELD_UINT8 = 3;
const FIELD_INT16 = 4;
const FIELD_UINT16 = 5;
const FIELD_INT32 = 6;
const FIELD_UINT32 = 7;
const FIELD_INT64 = 8;
const FIELD_UINT64 = 9;

interface PreparedField {
  kind: number;
  prefix: Buffer;
  bytes: Buffer;
  view: DataView | undefined;
  quote: boolean;
  input: number;
}

/** Writes JSON rows from the retained bytes of simple Native columns. */
export class BinaryJSONRows {
  private readonly escapes: Escapes;
  private readonly escapeKind: Uint8Array;
  private readonly quoteInt64: boolean;

  constructor(escapes: Escapes, escapeSlashes: boolean, quoteInt64: boolean) {
    this.escapes = escapeSlashes
      ? escapes
      : escapes.map((value, byte) => (byte === 47 ? undefined : value));
    const kind = new Uint8Array(256);
    for (let b = 0; b < 256; b++) {
      if (this.escapes[b] !== undefined) kind[b] = 1;
    }
    // 0xe2 starts UTF-8 U+2028 / U+2029, which ClickHouse escapes in JSON strings.
    kind[0xe2] = 2;
    this.escapeKind = kind;
    this.quoteInt64 = quoteInt64;
  }

  write(
    block: Block,
    prefixes: string[],
    suffix: "}\n" | "]\n",
  ): string | undefined {
    // JSON row layouts end with an ASCII bracket and a newline.
    const close = suffix.charCodeAt(0);
    const colCount = block.columns.length;
    const rows = block.rows;
    const fields = new Array<PreparedField>(colCount);
    let capacity = rows * 2;
    for (let i = 0; i < colCount; i++) {
      const column = block.columns[i] as Column;
      const bytes = column.binary;
      if (bytes === undefined) return;
      const field = prepareField(
        column.type,
        bytes,
        rows,
        Buffer.from(prefixes[i] as string),
        this.quoteInt64,
      );
      if (field === undefined) return;
      capacity += field.capacity + rows * field.field.prefix.length;
      if (capacity > MAX_BUFFER_SIZE) return;
      fields[i] = field.field;
    }
    let out: Buffer;
    if (capacity <= MAX_KEPT_SCRATCH_SIZE) {
      if (sharedScratch === undefined || sharedScratch.length < capacity) {
        sharedScratch = Buffer.allocUnsafe(capacity);
      }
      out = sharedScratch;
    } else {
      out = Buffer.allocUnsafe(capacity);
    }
    const escapes = this.escapes;
    const escapeKind = this.escapeKind;
    let pos = 0;
    for (let row = 0; row < rows; row++) {
      for (let f = 0; f < colCount; f++) {
        const field = fields[f]!;
        const prefix = field.prefix;
        const pLen = prefix.length;
        for (let i = 0; i < pLen; i++) out[pos++] = prefix[i]!;
        switch (field.kind) {
          case FIELD_STRING: {
            const src = field.bytes;
            let input = field.input;
            const length = src[input++]!;
            const end = input + length;
            out[pos++] = 34;
            while (input < end) {
              const byte = src[input++]!;
              const flag = escapeKind[byte]!;
              if (flag === 0) {
                out[pos++] = byte;
              } else if (flag === 2) {
                if (input + 1 < end && src[input] === 0x80) {
                  const last = src[input + 1];
                  if (last === 0xa8 || last === 0xa9) {
                    const esc =
                      last === 0xa8 ? LINE_SEPARATOR : PARAGRAPH_SEPARATOR;
                    out.set(esc, pos);
                    pos += esc.length;
                    input += 2;
                    continue;
                  }
                }
                out[pos++] = byte;
              } else {
                const esc = escapes[byte]!;
                out.set(esc, pos);
                pos += esc.length;
              }
            }
            out[pos++] = 34;
            field.input = input;
            break;
          }
          case FIELD_BOOL: {
            const val = field.bytes[row] === 0 ? FALSE : TRUE;
            out.set(val, pos);
            pos += val.length;
            break;
          }
          case FIELD_UINT8:
            pos = writeUnsigned32(out, pos, field.bytes[row]!);
            break;
          case FIELD_INT8:
            pos = writeSigned32(out, pos, field.view!.getInt8(row));
            break;
          case FIELD_UINT16:
            pos = writeUnsigned32(
              out,
              pos,
              field.view!.getUint16(row * 2, true),
            );
            break;
          case FIELD_INT16:
            pos = writeSigned32(out, pos, field.view!.getInt16(row * 2, true));
            break;
          case FIELD_UINT32:
            pos = writeUnsigned32(
              out,
              pos,
              field.view!.getUint32(row * 4, true),
            );
            break;
          case FIELD_INT32:
            pos = writeSigned32(out, pos, field.view!.getInt32(row * 4, true));
            break;
          case FIELD_UINT64: {
            const view = field.view!;
            const offset = row * 8;
            if (field.quote) out[pos++] = 34;
            const hi = view.getUint32(offset + 4, true);
            if (hi === 0) {
              pos = writeUnsigned32(out, pos, view.getUint32(offset, true));
            } else if (hi < 0x200000) {
              pos += out.write(
                String(hi * 0x100000000 + view.getUint32(offset, true)),
                pos,
                "ascii",
              );
            } else {
              pos += out.write(
                String(view.getBigUint64(offset, true)),
                pos,
                "ascii",
              );
            }
            if (field.quote) out[pos++] = 34;
            break;
          }
          case FIELD_INT64: {
            const view = field.view!;
            const offset = row * 8;
            if (field.quote) out[pos++] = 34;
            const hi = view.getInt32(offset + 4, true);
            if (hi === 0) {
              pos = writeUnsigned32(out, pos, view.getUint32(offset, true));
            } else if (hi === -1) {
              const lo = view.getUint32(offset, true);
              if (lo !== 0) {
                out[pos++] = 45;
                pos = writeUnsigned32(out, pos, (~lo >>> 0) + 1);
              } else {
                pos += out.write("-4294967296", pos, "ascii");
              }
            } else if (hi > -0x200000 && hi < 0x200000) {
              pos += out.write(
                String(hi * 0x100000000 + view.getUint32(offset, true)),
                pos,
                "ascii",
              );
            } else {
              pos += out.write(
                String(view.getBigInt64(offset, true)),
                pos,
                "ascii",
              );
            }
            if (field.quote) out[pos++] = 34;
            break;
          }
        }
      }
      out[pos++] = close;
      out[pos++] = 10;
    }
    // The string owns its contents. The next block can reuse the buffer.
    return out.toString("utf8", 0, pos);
  }
}

function prepareField(
  type: ColumnType,
  bytes: Buffer,
  rows: number,
  prefix: Buffer,
  quoteInt64: boolean,
): { capacity: number; field: PreparedField } | undefined {
  switch (type.kind) {
    case "String":
      return {
        // Each value has a one-byte length. An escaped byte occupies at most six bytes.
        capacity: (bytes.length - rows) * 6 + 2 * rows,
        field: {
          kind: FIELD_STRING,
          prefix,
          bytes,
          view: undefined,
          quote: false,
          input: 0,
        },
      };
    case "Bool":
      return {
        capacity: rows * FALSE.length,
        field: {
          kind: FIELD_BOOL,
          prefix,
          bytes,
          view: undefined,
          quote: false,
          input: 0,
        },
      };
    case "Int": {
      let kind: number;
      switch (type.bits) {
        case 8:
          kind = type.signed ? FIELD_INT8 : FIELD_UINT8;
          break;
        case 16:
          kind = type.signed ? FIELD_INT16 : FIELD_UINT16;
          break;
        case 32:
          kind = type.signed ? FIELD_INT32 : FIELD_UINT32;
          break;
        case 64:
          kind = type.signed ? FIELD_INT64 : FIELD_UINT64;
          break;
        default:
          return undefined;
      }
      const quote = quoteInt64 && type.bits === 64;
      const width = type.bits <= 32 ? 11 : 20;
      const view =
        kind === FIELD_UINT8
          ? undefined
          : new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return {
        capacity: rows * (width + (quote ? 2 : 0)),
        field: { kind, prefix, bytes, view, quote, input: 0 },
      };
    }
    default:
      return undefined;
  }
}

function writeSigned32(out: Buffer, pos: number, value: number): number {
  if (value < 0) {
    out[pos++] = 45;
    return writeUnsigned32(out, pos, -value);
  }
  return writeUnsigned32(out, pos, value);
}

function writeUnsigned32(out: Buffer, pos: number, value: number): number {
  if (value < 10) {
    out[pos] = 48 + value;
    return pos + 1;
  }
  if (value < 100) {
    const pair = value * 2;
    out[pos] = DIGIT_PAIRS[pair]!;
    out[pos + 1] = DIGIT_PAIRS[pair + 1]!;
    return pos + 2;
  }
  const end = pos + decimalWidth(value);
  pos = end;
  while (value >= 100) {
    const pair = (value % 100) * 2;
    out[--pos] = DIGIT_PAIRS[pair + 1]!;
    out[--pos] = DIGIT_PAIRS[pair]!;
    value = Math.floor(value / 100);
  }
  if (value >= 10) {
    out[pos - 1] = DIGIT_PAIRS[value * 2 + 1]!;
    out[pos - 2] = DIGIT_PAIRS[value * 2]!;
  } else {
    out[pos - 1] = 48 + value;
  }
  return end;
}

function decimalWidth(value: number): number {
  if (value < 1000) return 3;
  if (value < 10000) return 4;
  if (value < 100000) return 5;
  if (value < 1000000) return 6;
  if (value < 10000000) return 7;
  if (value < 100000000) return 8;
  if (value < 1000000000) return 9;
  return 10;
}
