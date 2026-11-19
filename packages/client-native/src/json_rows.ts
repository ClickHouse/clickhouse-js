import type { Block, Column } from "./protocol/packets";
import type { ColumnType } from "./protocol/types";

type Integer = Extract<ColumnType, { kind: "Int" }>;
type Escapes = ReadonlyArray<Buffer | undefined>;
type WriteValue = (out: Buffer, pos: number, row: number) => number;

const MAX_BUFFER_SIZE = 16 * 1024 * 1024;
const TRUE = Buffer.from("true");
const FALSE = Buffer.from("false");
const LINE_SEPARATOR = Buffer.from("\\u2028");
const PARAGRAPH_SEPARATOR = Buffer.from("\\u2029");
const DIGIT_PAIRS = Uint8Array.from(
  { length: 200 },
  (_, i) => 48 + (i % 2 === 0 ? Math.floor(i / 20) : Math.floor(i / 2) % 10),
);

/** Writes JSON rows from the retained bytes of simple Native columns. */
export class BinaryJSONRows {
  private buffer = Buffer.alloc(0);
  private readonly escapes: Escapes;
  private readonly quoteInt64: boolean;

  constructor(escapes: Escapes, escapeSlashes: boolean, quoteInt64: boolean) {
    this.escapes = escapeSlashes
      ? escapes
      : escapes.map((value, byte) => (byte === 47 ? undefined : value));
    this.quoteInt64 = quoteInt64;
  }

  write(
    block: Block,
    prefixes: string[],
    suffix: "}\n" | "]\n",
  ): string | undefined {
    // JSON row layouts end with an ASCII bracket and a newline.
    const close = suffix.charCodeAt(0);
    const fields: Array<{ prefix: Buffer; write: WriteValue }> = [];
    let capacity = block.rows * 2;
    for (let i = 0; i < block.columns.length; i++) {
      const column = block.columns[i] as Column;
      if (column.binary === undefined) return;
      const field = prepareField(
        column.type,
        column.binary,
        block.rows,
        this.escapes,
        this.quoteInt64,
      );
      if (field === undefined) return;
      const prefix = Buffer.from(prefixes[i] as string);
      capacity += field.capacity + block.rows * prefix.length;
      if (capacity > MAX_BUFFER_SIZE) return;
      fields.push({ prefix, write: field.write });
    }
    if (this.buffer.length < capacity)
      this.buffer = Buffer.allocUnsafe(capacity);
    const out = this.buffer;
    let pos = 0;
    for (let row = 0; row < block.rows; row++) {
      for (const { prefix, write } of fields) {
        // eslint-disable-next-line @typescript-eslint/prefer-for-of -- Avoid a Buffer iterator for each field of each row.
        for (let i = 0; i < prefix.length; i++) out[pos++] = prefix[i]!;
        pos = write(out, pos, row);
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
  escapes: Escapes,
  quoteInt64: boolean,
): { capacity: number; write: WriteValue } | undefined {
  switch (type.kind) {
    case "String": {
      let input = 0;
      return {
        // Each value has a one-byte length. An escaped byte occupies at most six bytes.
        capacity: (bytes.length - rows) * 6 + 2 * rows,
        write: (out, pos) => {
          const length = bytes[input++]!;
          const end = input + length;
          out[pos++] = 34;
          while (input < end) {
            const byte = bytes[input++]!;
            let escaped = escapes[byte];
            // ClickHouse also escapes U+2028 and U+2029 in JSON strings.
            if (byte === 0xe2 && input + 1 < end && bytes[input] === 0x80) {
              const last = bytes[input + 1];
              if (last === 0xa8 || last === 0xa9) {
                escaped = last === 0xa8 ? LINE_SEPARATOR : PARAGRAPH_SEPARATOR;
                input += 2;
              }
            }
            if (escaped === undefined) {
              out[pos++] = byte;
            } else {
              out.set(escaped, pos);
              pos += escaped.length;
            }
          }
          out[pos++] = 34;
          return pos;
        },
      };
    }
    case "Bool":
      return {
        capacity: rows * FALSE.length,
        write: (out, pos, row) => {
          const value = bytes[row] === 0 ? FALSE : TRUE;
          out.set(value, pos);
          return pos + value.length;
        },
      };
    case "Int": {
      const read = integerReader(type, bytes);
      if (read === undefined) return;
      const quote = quoteInt64 && type.bits === 64;
      const width = type.bits <= 32 ? 11 : 20;
      return {
        capacity: rows * (width + (quote ? 2 : 0)),
        write: (out, pos, row) => {
          if (quote) out[pos++] = 34;
          pos = writeInteger(out, pos, read(row));
          if (quote) out[pos++] = 34;
          return pos;
        },
      };
    }
  }
}

function integerReader(
  type: Integer,
  bytes: Buffer,
): ((row: number) => number | bigint) | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const { signed } = type;
  switch (type.bits) {
    case 8:
      return signed ? (row) => view.getInt8(row) : (row) => bytes[row]!;
    case 16:
      return signed
        ? (row) => view.getInt16(row * 2, true)
        : (row) => view.getUint16(row * 2, true);
    case 32:
      return signed
        ? (row) => view.getInt32(row * 4, true)
        : (row) => view.getUint32(row * 4, true);
    case 64:
      return (row) => {
        const offset = row * 8;
        const high = signed
          ? view.getInt32(offset + 4, true)
          : view.getUint32(offset + 4, true);
        if (high >= -(2 ** 21) && high < 2 ** 21) {
          return high * 2 ** 32 + view.getUint32(offset, true);
        }
        return signed
          ? view.getBigInt64(offset, true)
          : view.getBigUint64(offset, true);
      };
  }
}

function writeInteger(
  out: Buffer,
  pos: number,
  value: number | bigint,
): number {
  if (typeof value === "bigint" || value < -0xffffffff || value > 0xffffffff) {
    return pos + out.write(String(value), pos, "ascii");
  }
  if (value < 0) {
    out[pos++] = 45;
    value = -value;
  }
  if (value < 10) {
    out[pos] = 48 + value;
    return pos + 1;
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
  if (value < 100) return 2;
  if (value < 1000) return 3;
  if (value < 10000) return 4;
  if (value < 100000) return 5;
  if (value < 1000000) return 6;
  if (value < 10000000) return 7;
  if (value < 100000000) return 8;
  if (value < 1000000000) return 9;
  return 10;
}
