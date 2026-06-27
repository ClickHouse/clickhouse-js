import { type Reader, type Writer } from "./core.js";
import { readUInt8, writeUInt8 } from "./integers.js";
import { readUVarint, writeUVarint } from "./varint.js";

/**
 * Read a `Nullable(T)`: a 1-byte null flag (0 = present, non-zero = NULL).
 * Curried: pass the inner reader, get a `Reader<T | null>`.
 *
 * GOTCHA: the inner value bytes follow ONLY when the flag is 0. A NULL is the
 * single `0x01` flag byte with nothing after it — so do NOT read the inner value
 * when the flag is set, or the cursor desyncs.
 *
 * `readValue` decodes the inner `T`. This generic combinator is the reference
 * shape; when generating code, MONOMORPHIZE — emit a dedicated `readNullableX`
 * that inlines the inner read:
 *
 *   const readNullableUInt32 = (s) => readUInt8(s) !== 0 ? null : readUInt32(s);
 */
export function readNullable<T>(readValue: Reader<T>): Reader<T | null> {
  return (state) => (readUInt8(state) !== 0 ? null : readValue(state));
}

/**
 * Read an `Array(T)`: a LEB128 element count, then that many `T` values
 * back-to-back. An empty array is just the count byte `0x00`. Curried: pass the
 * element reader, get a `Reader<T[]>`.
 *
 * ARRAY LAYOUT: the count is known up front (the LEB128 prefix), so a generated
 * reader can pre-size. Pick by how the result is used:
 *  - small / consumed-as-is (the common case) → DEFAULT to `new Array(n)` +
 *    index assignment; it skips `push`'s repeated capacity growth. A clean-room
 *    benchmark found this edged out `push` on the small composite arrays here
 *    (`baseline/README.md`).
 *  - large + iterated/computed-over downstream → `[]` + `push` keeps it a PACKED
 *    elements kind (faster to traverse; a pre-sized array is HOLEY), or use a
 *    typed array (`Float64Array`…) for numeric elements.
 * This generic combinator uses `push` for simplicity; the monomorphized
 * `readArrayX` below should choose per the rule above.
 *
 * `readElement` decodes one element. This generic combinator is the reference
 * shape; when generating code, MONOMORPHIZE — emit a dedicated `readArrayX` that
 * inlines the element read in the loop (and pre-sizes for the common small case):
 *
 *   function readArrayUInt32(s) {
 *     const n = readUVarint(s);
 *     const out = new Array(n);
 *     for (let i = 0; i < n; i++) out[i] = readUInt32(s);
 *     return out;
 *   }
 */
export function readArray<T>(readElement: Reader<T>): Reader<T[]> {
  return (state) => {
    const n = readUVarint(state);
    const out: T[] = [];
    for (let i = 0; i < n; i++) out.push(readElement(state));
    return out;
  };
}

/**
 * Read a `QBit(element_type, dimension)` vector. `QBit` is a vector-search type
 * whose ON-DISK layout is quantized and bit-transposed — but that is a STORAGE /
 * Native-format concern. In RowBinary a `QBit` is fully TRANSPARENT: it is the
 * plain vector, encoded byte-for-byte like `Array(element_type)` (a LEB128
 * length, then `dimension` element values). So this is just {@link readArray}.
 *
 * `element_type` is one of `BFloat16` / `Float32` / `Float64`, so `readElement`
 * is the matching float reader. When generating code, MONOMORPHIZE — inline the
 * element read in the loop.
 */
export function readQBit<T>(readElement: Reader<T>): Reader<T[]> {
  return readArray(readElement);
}

/**
 * Read a `Tuple(...)` into a positional array: each element's value back-to-back,
 * with NO count and NO delimiter. Curried: pass one reader per element (in
 * order), get a `Reader` of the tuple. For a named tuple as an object, use
 * {@link readTupleNamed} (identical wire).
 *
 * Reference shape; when generating code, MONOMORPHIZE — emit the inline sequence
 * with no array-of-readers and no loop:
 *
 *   [readUInt32(s), readString(s)]
 */
export function readTuple<T extends readonly unknown[]>(readers: {
  [K in keyof T]: Reader<T[K]>;
}): Reader<T> {
  return (state) => {
    const out: unknown[] = [];
    for (const read of readers as ReadonlyArray<Reader<unknown>>) {
      out.push(read(state));
    }
    return out as unknown as T;
  };
}

/**
 * Read a named `Tuple(name1 T1, ...)` into an object. The wire is identical to
 * an unnamed tuple — values back-to-back, no count or delimiter — so the
 * `readers` object's keys MUST be listed in the tuple's declared field order
 * (JS iterates string keys in insertion order), and each reader runs in that
 * order. Curried: pass the readers object, get a `Reader` of the result object.
 *
 * Reference shape; when generating code, MONOMORPHIZE — emit the inline object
 * literal instead of looping over entries:
 *
 *   { id: readUInt32(s), name: readString(s) }
 */
export function readTupleNamed<T extends Record<string, unknown>>(readers: {
  [K in keyof T]: Reader<T[K]>;
}): Reader<T> {
  const fns = readers as Record<string, Reader<unknown>>;
  const keys = Object.keys(fns);
  return (state) => {
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = fns[key]!(state);
    return out as T;
  };
}

/**
 * Read a `Map(K, V)`: a LEB128 pair count, then that many key/value pairs with
 * key and value interleaved (k, v, k, v, ...) — a flattened `Array(Tuple(K, V))`.
 * An empty map is just the count byte `0x00`. Curried: pass the key and value
 * readers, get a `Reader<Map<K, V>>`.
 *
 * The key is read BEFORE the value in each pair. Returns a JS `Map`, which keeps
 * insertion order and accepts any key type.
 *
 * Reference shape; when generating code, MONOMORPHIZE — inline both reads in the
 * loop.
 */
export function readMap<K, V>(
  readKey: Reader<K>,
  readValue: Reader<V>,
): Reader<Map<K, V>> {
  return (state) => {
    const n = readUVarint(state);
    const out = new Map<K, V>();
    for (let i = 0; i < n; i++) {
      const key = readKey(state);
      out.set(key, readValue(state));
    }
    return out;
  };
}

/**
 * Read a `Variant(T1, ..., Tn)`: a 1-byte discriminant selecting the active
 * alternative, then that alternative's value. Discriminant `0xFF` means NULL.
 * Curried: pass the alternative readers (in sorted-type-name order), get a
 * `Reader`.
 *
 * GOTCHA: the discriminant indexes the alternatives sorted by type NAME
 * (ClickHouse globally sorts them), NOT their declaration order. So `readers`
 * MUST be ordered by sorted type name. E.g. `Variant(UInt8, String)` sorts to
 * ["String", "UInt8"], so discriminant 0 = String and 1 = UInt8.
 *
 * Reference shape; when generating code, MONOMORPHIZE — emit a `switch` over the
 * discriminant with each branch inlined, alternatives in sorted order, `0xFF`
 * -> null.
 */
export function readVariant<T extends readonly unknown[]>(readers: {
  [K in keyof T]: Reader<T[K]>;
}): Reader<T[number] | null> {
  const fns = readers as ReadonlyArray<Reader<T[number]>>;
  return (state) => {
    const discriminant = readUInt8(state);
    if (discriminant === 0xff) return null;
    const fn = fns[discriminant];
    if (fn === undefined) {
      // Out-of-range discriminant (corrupted/truncated input): fail loudly
      // instead of throwing a cryptic "fns[discriminant] is not a function".
      throw new RangeError(
        `RowBinary Variant: discriminant ${discriminant} out of range (${fns.length} alternatives)`,
      );
    }
    return fn(state);
  };
}

// --- Writers: the encode mirror of the combinators above. Each takes sub-WRITERS
// (instead of sub-readers) and returns a Writer; MONOMORPHIZE when generating
// code, exactly as noted for the readers.

/**
 * Write a `Nullable(T)`: a 1-byte null flag (0 = present, 1 = NULL), then the
 * inner value ONLY when present. The inverse of {@link readNullable}; curried —
 * pass the inner writer, get a `Writer<T | null>`.
 */
export function writeNullable<T>(writeValue: Writer<T>): Writer<T | null> {
  return (sink, value) => {
    if (value === null) {
      writeUInt8(sink, 1);
    } else {
      writeUInt8(sink, 0);
      writeValue(sink, value);
    }
  };
}

/**
 * Write an `Array(T)`: a LEB128 element count, then each element back-to-back.
 * The inverse of {@link readArray}; curried — pass the element writer, get a
 * `Writer<T[]>`.
 */
export function writeArray<T>(writeElement: Writer<T>): Writer<readonly T[]> {
  return (sink, values) => {
    writeUVarint(sink, values.length);
    for (const value of values) writeElement(sink, value);
  };
}

/**
 * Write a `QBit(element_type, dimension)`: in RowBinary it is byte-for-byte an
 * `Array(element_type)`, so this is just {@link writeArray}. The inverse of
 * {@link readQBit}.
 */
export function writeQBit<T>(writeElement: Writer<T>): Writer<readonly T[]> {
  return writeArray(writeElement);
}

/**
 * Write a `Tuple(...)` from a positional array: each element's value
 * back-to-back, with NO count and NO delimiter. The inverse of {@link readTuple};
 * curried — pass one writer per element (in order), get a `Writer` of the tuple.
 */
export function writeTuple<T extends readonly unknown[]>(writers: {
  [K in keyof T]: Writer<T[K]>;
}): Writer<T> {
  const fns = writers as ReadonlyArray<Writer<unknown>>;
  return (sink, value) => {
    for (let i = 0; i < fns.length; i++) fns[i]!(sink, value[i]);
  };
}

/**
 * Write a named `Tuple(name1 T1, ...)` from an object. The wire is identical to
 * an unnamed tuple — values back-to-back, no count or delimiter — so the writers
 * run in the `writers` object's key order, which MUST match the tuple's declared
 * field order. The inverse of {@link readTupleNamed}; curried.
 */
export function writeTupleNamed<T extends Record<string, unknown>>(writers: {
  [K in keyof T]: Writer<T[K]>;
}): Writer<T> {
  const fns = writers as Record<string, Writer<unknown>>;
  const keys = Object.keys(fns);
  return (sink, value) => {
    for (const key of keys) fns[key]!(sink, value[key]);
  };
}

/**
 * Write a `Map(K, V)`: a LEB128 pair count, then key/value interleaved
 * (k, v, k, v, ...). The inverse of {@link readMap}; curried — pass the key and
 * value writers, get a `Writer<Map<K, V>>` (`Map` iteration order is preserved).
 */
export function writeMap<K, V>(
  writeKey: Writer<K>,
  writeValue: Writer<V>,
): Writer<ReadonlyMap<K, V>> {
  return (sink, map) => {
    writeUVarint(sink, map.size);
    for (const [key, value] of map) {
      writeKey(sink, key);
      writeValue(sink, value);
    }
  };
}

/**
 * A tagged `Variant` value for {@link writeVariant}: the active alternative's
 * `discriminant` (its index in the sorted-type-name order) paired with its
 * value, or `null` for a NULL.
 *
 * WHY TAGGED: {@link readVariant} returns only the decoded VALUE — the
 * discriminant is consumed from the wire and not surfaced — so encode cannot
 * recover which alternative a bare value belongs to (e.g. is `5` the `UInt8` or
 * the `Int32` alternative?). The discriminant must therefore be supplied
 * explicitly, the encode-side analog of the `readGeometry` switch.
 */
export type VariantValue = readonly [discriminant: number, value: unknown] | null;

/**
 * Write a `Variant(T1, ..., Tn)`: a 1-byte discriminant then the chosen
 * alternative's value (discriminant `0xFF` = NULL, no value). The inverse of
 * {@link readVariant}; curried — pass the alternative writers in
 * sorted-type-name order (same order the reader expects), get a
 * `Writer<VariantValue>`.
 */
export function writeVariant(
  writers: ReadonlyArray<Writer<never>>,
): Writer<VariantValue> {
  return (sink, value) => {
    if (value === null) {
      writeUInt8(sink, 0xff);
      return;
    }
    const [discriminant, inner] = value;
    const fn = writers[discriminant] as Writer<unknown> | undefined;
    if (fn === undefined) {
      throw new RangeError(
        `RowBinary Variant: discriminant ${discriminant} out of range (${writers.length} alternatives)`,
      );
    }
    writeUInt8(sink, discriminant);
    fn(sink, inner);
  };
}
