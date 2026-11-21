import { BinaryWriter } from "../binary";
import type { ColumnType } from "../types";
import { compareBytes } from "../types";
import type { DynamicNorm, VariantNorm } from "./errors";
import { InsertValueError, ServerParseNeeded } from "./errors";
import { defaultValue } from "./normalize";

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
    case "QBit":
      writeQBit(w, type.element, type.dimension, type.stride, values);
      return;
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

/**
 * Encodes a `QBit(Int8 | BFloat16 | Float32 | Float64, dimension[, stride])`
 * column into its bit-transposed Native representation.
 */
function writeQBit(
  w: BinaryWriter,
  element:
    | { kind: "Int"; bits: 8; signed: true }
    | { kind: "BFloat16" }
    | { kind: "Float"; bits: 32 | 64 },
  dimension: number,
  stride: number,
  values: unknown[],
): void {
  const rows = values.length;
  if (rows === 0) return;
  const bits =
    element.kind === "BFloat16"
      ? 16
      : element.kind === "Int"
        ? 8
        : element.bits;
  const numGroups = dimension / stride;
  const groupBytes = (stride + 7) >>> 3;
  const planeBytes = rows * groupBytes;
  const groupTotalBytes = bits * planeBytes;
  const buf = Buffer.alloc(numGroups * groupTotalBytes);
  const scratch = new ArrayBuffer(8);
  const dv = new DataView(scratch);

  for (let g = 0; g < numGroups; g++) {
    const groupBase = g * groupTotalBytes;
    const elemOffset = g * stride;
    if (bits === 8) {
      for (let row = 0; row < rows; row++) {
        const vec = values[row] as number[];
        const rowBase = groupBase + row * groupBytes;
        for (let j = 0; j < stride; j++) {
          const bits8 = (vec[elemOffset + j] as number) & 0xff;
          const byteOff = rowBase + (groupBytes - 1 - (j >>> 3));
          const bitMask = 1 << (j & 7);
          for (let p = 0; p < 8; p++) {
            if ((bits8 & (1 << (7 - p))) !== 0) {
              buf[byteOff + p * planeBytes] =
                (buf[byteOff + p * planeBytes] as number) | bitMask;
            }
          }
        }
      }
    } else if (bits === 16) {
      for (let row = 0; row < rows; row++) {
        const vec = values[row] as number[];
        const rowBase = groupBase + row * groupBytes;
        for (let j = 0; j < stride; j++) {
          dv.setFloat32(0, vec[elemOffset + j] as number, false);
          const bits16 = dv.getUint16(0, false);
          const byteOff = rowBase + (groupBytes - 1 - (j >>> 3));
          const bitMask = 1 << (j & 7);
          for (let p = 0; p < 16; p++) {
            if ((bits16 & (1 << (15 - p))) !== 0) {
              buf[byteOff + p * planeBytes] =
                (buf[byteOff + p * planeBytes] as number) | bitMask;
            }
          }
        }
      }
    } else if (bits === 32) {
      for (let row = 0; row < rows; row++) {
        const vec = values[row] as number[];
        const rowBase = groupBase + row * groupBytes;
        for (let j = 0; j < stride; j++) {
          dv.setFloat32(0, vec[elemOffset + j] as number, false);
          const bits32 = dv.getUint32(0, false);
          const byteOff = rowBase + (groupBytes - 1 - (j >>> 3));
          const bitMask = 1 << (j & 7);
          for (let p = 0; p < 32; p++) {
            if ((bits32 & (1 << (31 - p))) !== 0) {
              buf[byteOff + p * planeBytes] =
                (buf[byteOff + p * planeBytes] as number) | bitMask;
            }
          }
        }
      }
    } else {
      for (let row = 0; row < rows; row++) {
        const vec = values[row] as number[];
        const rowBase = groupBase + row * groupBytes;
        for (let j = 0; j < stride; j++) {
          dv.setFloat64(0, vec[elemOffset + j] as number, false);
          const hi = dv.getUint32(0, false);
          const lo = dv.getUint32(4, false);
          const byteOff = rowBase + (groupBytes - 1 - (j >>> 3));
          const bitMask = 1 << (j & 7);
          for (let p = 0; p < 32; p++) {
            if ((hi & (1 << (31 - p))) !== 0) {
              buf[byteOff + p * planeBytes] =
                (buf[byteOff + p * planeBytes] as number) | bitMask;
            }
          }
          for (let p = 0; p < 32; p++) {
            if ((lo & (1 << (31 - p))) !== 0) {
              buf[byteOff + (32 + p) * planeBytes] =
                (buf[byteOff + (32 + p) * planeBytes] as number) | bitMask;
            }
          }
        }
      }
    }
  }
  w.append(buf);
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
