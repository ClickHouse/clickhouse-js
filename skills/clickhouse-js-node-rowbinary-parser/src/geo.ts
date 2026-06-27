import { Cursor, type Writer, type Sink } from "./core.js";
import { readFloat64, writeFloat64 } from "./floats.js";
import { readUInt8, writeUInt8 } from "./integers.js";
import { readUVarint, writeUVarint } from "./varint.js";

/** A geo `Point`: `[x, y]`, the base of every ClickHouse geo type. */
export type Point = [x: number, y: number];

// Geo types are concrete compositions of Point = Tuple(Float64, Float64). They
// are monomorphic (no sub-readers) — the generator can emit them as-is.

/** Read a `Point`: `Tuple(Float64, Float64)` -> `[x, y]`. */
export function readPoint(state: Cursor): Point {
  const x = readFloat64(state);
  const y = readFloat64(state);
  return [x, y];
}

/**
 * Read a `Ring`: `Array(Point)` — a LEB128 point count, then that many points.
 * `LineString` has the identical wire (see {@link readLineString}). `readPoint`
 * is inlined here (two `readFloat64`s) to drop a call per point on this hot path.
 */
export function readRing(state: Cursor): Point[] {
  const n = readUVarint(state);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const x = readFloat64(state);
    const y = readFloat64(state);
    out.push([x, y]);
  }
  return out;
}

/**
 * Read a `LineString`: `Array(Point)` (identical wire to a `Ring`). Points are
 * inlined (two `readFloat64`s) to drop a call per point on this hot path.
 */
export function readLineString(state: Cursor): Point[] {
  const n = readUVarint(state);
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const x = readFloat64(state);
    const y = readFloat64(state);
    out.push([x, y]);
  }
  return out;
}

/** Read a `Polygon`: `Array(Ring)` — the outer ring first, then any holes. */
export function readPolygon(state: Cursor): Point[][] {
  const n = readUVarint(state);
  const out: Point[][] = [];
  for (let i = 0; i < n; i++) out.push(readRing(state));
  return out;
}

/** Read a `MultiLineString`: `Array(LineString)` (identical wire to a `Polygon`). */
export function readMultiLineString(state: Cursor): Point[][] {
  const n = readUVarint(state);
  const out: Point[][] = [];
  for (let i = 0; i < n; i++) out.push(readLineString(state));
  return out;
}

/** Read a `MultiPolygon`: `Array(Polygon)`. */
export function readMultiPolygon(state: Cursor): Point[][][] {
  const n = readUVarint(state);
  const out: Point[][][] = [];
  for (let i = 0; i < n; i++) out.push(readPolygon(state));
  return out;
}

/**
 * Read a `Geometry`: a named `Variant` over the six geo types. This is the
 * MONOMORPHIZED form of `readVariant` for a concrete variant — a switch over the
 * discriminant with each branch inlined, no reader array. The alternatives,
 * sorted by type name (so in discriminant order), are LineString(0),
 * MultiLineString(1), MultiPolygon(2), Point(3), Polygon(4), Ring(5); 0xFF is NULL.
 *
 * NOTE: the value shapes overlap — LineString and Ring are both `Point[]`,
 * MultiLineString and Polygon both `Point[][]` — so the value alone does not say
 * which geo type it was. If you need the kind, branch on the discriminant.
 */
export function readGeometry(
  state: Cursor,
): Point | Point[] | Point[][] | Point[][][] | null {
  const discriminant = readUInt8(state);
  switch (discriminant) {
    case 0:
      return readLineString(state);
    case 1:
      return readMultiLineString(state);
    case 2:
      return readMultiPolygon(state);
    case 3:
      return readPoint(state);
    case 4:
      return readPolygon(state);
    case 5:
      return readRing(state);
    case 0xff:
      return null;
    default:
      throw new RangeError(
        `RowBinary: unknown Geometry discriminant ${discriminant}`,
      );
  }
}

/** Write a `Point`: `Tuple(Float64, Float64)` -> `[x, y]`. Inverse of {@link readPoint}. */
export function writePoint(sink: Sink, [x, y]: Point): void {
  writeFloat64(sink, x);
  writeFloat64(sink, y);
}

/**
 * Write a `Ring`: `Array(Point)` — a LEB128 point count, then each point. The
 * inverse of {@link readRing}; points are inlined (two `writeFloat64`s) to drop a
 * call per point, mirroring the reader.
 */
export function writeRing(sink: Sink, points: readonly Point[]): void {
  writeUVarint(sink, points.length);
  for (const [x, y] of points) {
    writeFloat64(sink, x);
    writeFloat64(sink, y);
  }
}

/** Write a `LineString`: `Array(Point)` (identical wire to a `Ring`). Inverse of {@link readLineString}. */
export function writeLineString(sink: Sink, points: readonly Point[]): void {
  writeUVarint(sink, points.length);
  for (const [x, y] of points) {
    writeFloat64(sink, x);
    writeFloat64(sink, y);
  }
}

/** Write a `Polygon`: `Array(Ring)` — outer ring first, then holes. Inverse of {@link readPolygon}. */
export function writePolygon(sink: Sink, rings: readonly Point[][]): void {
  writeUVarint(sink, rings.length);
  for (const ring of rings) writeRing(sink, ring);
}

/** Write a `MultiLineString`: `Array(LineString)`. Inverse of {@link readMultiLineString}. */
export function writeMultiLineString(
  sink: Sink,
  lines: readonly Point[][],
): void {
  writeUVarint(sink, lines.length);
  for (const line of lines) writeLineString(sink, line);
}

/** Write a `MultiPolygon`: `Array(Polygon)`. Inverse of {@link readMultiPolygon}. */
export function writeMultiPolygon(
  sink: Sink,
  polygons: readonly Point[][][],
): void {
  writeUVarint(sink, polygons.length);
  for (const polygon of polygons) writePolygon(sink, polygon);
}

/**
 * A tagged `Geometry` value for {@link writeGeometry}: the alternative's
 * `discriminant` paired with its value, or `null` for NULL. Like
 * {@link readVariant}/`writeVariant`, {@link readGeometry} returns only the value
 * — and the geo value shapes overlap (LineString and Ring are both `Point[]`,
 * MultiLineString and Polygon both `Point[][]`) — so encode must be told which
 * geo type it is via the discriminant.
 *
 * Discriminants (sorted by type name): LineString(0), MultiLineString(1),
 * MultiPolygon(2), Point(3), Polygon(4), Ring(5); `0xFF` = NULL.
 */
export type GeometryValue = readonly [discriminant: number, value: unknown] | null;

/**
 * Write a `Geometry`: a 1-byte discriminant then the chosen geo type's value.
 * The inverse of {@link readGeometry} (a switch over the discriminant with each
 * branch inlined). Takes a tagged {@link GeometryValue} because the value shapes
 * are ambiguous on their own.
 */
export const writeGeometry: Writer<GeometryValue> = (sink, value) => {
  if (value === null) {
    writeUInt8(sink, 0xff);
    return;
  }
  const [discriminant, geo] = value;
  writeUInt8(sink, discriminant);
  switch (discriminant) {
    case 0:
      return writeLineString(sink, geo as Point[]);
    case 1:
      return writeMultiLineString(sink, geo as Point[][]);
    case 2:
      return writeMultiPolygon(sink, geo as Point[][][]);
    case 3:
      return writePoint(sink, geo as Point);
    case 4:
      return writePolygon(sink, geo as Point[][]);
    case 5:
      return writeRing(sink, geo as Point[]);
    default:
      throw new RangeError(
        `RowBinary: unknown Geometry discriminant ${discriminant}`,
      );
  }
};
