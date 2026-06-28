import { type Writer, Sink } from "./core_writer.js";
import { type Point } from "./geo.js";
import { writeFloat64 } from "./floats_writer.js";
import { writeUInt8 } from "./integers_writer.js";
import { writeUVarint } from "./varint_writer.js";

/** Write a `Point`: `Tuple(Float64, Float64)` -> `[x, y]`. Inverse of `readPoint`. */
export function writePoint(sink: Sink, [x, y]: Point): void {
  writeFloat64(sink, x);
  writeFloat64(sink, y);
}

/**
 * Write a `Ring`: `Array(Point)` — a LEB128 point count, then each point. The
 * inverse of `readRing`; points are inlined (two `writeFloat64`s) to drop a call
 * per point, mirroring the reader.
 */
export function writeRing(sink: Sink, points: readonly Point[]): void {
  writeUVarint(sink, points.length);
  for (const [x, y] of points) {
    writeFloat64(sink, x);
    writeFloat64(sink, y);
  }
}

/** Write a `LineString`: `Array(Point)` (identical wire to a `Ring`). Inverse of `readLineString`. */
export function writeLineString(sink: Sink, points: readonly Point[]): void {
  writeUVarint(sink, points.length);
  for (const [x, y] of points) {
    writeFloat64(sink, x);
    writeFloat64(sink, y);
  }
}

/** Write a `Polygon`: `Array(Ring)` — outer ring first, then holes. Inverse of `readPolygon`. */
export function writePolygon(sink: Sink, rings: readonly Point[][]): void {
  writeUVarint(sink, rings.length);
  for (const ring of rings) writeRing(sink, ring);
}

/** Write a `MultiLineString`: `Array(LineString)`. Inverse of `readMultiLineString`. */
export function writeMultiLineString(
  sink: Sink,
  lines: readonly Point[][],
): void {
  writeUVarint(sink, lines.length);
  for (const line of lines) writeLineString(sink, line);
}

/** Write a `MultiPolygon`: `Array(Polygon)`. Inverse of `readMultiPolygon`. */
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
 * `readVariant`/`writeVariant`, `readGeometry` returns only the value — and the
 * geo value shapes overlap (LineString and Ring are both `Point[]`,
 * MultiLineString and Polygon both `Point[][]`) — so encode must be told which geo
 * type it is via the discriminant.
 *
 * Discriminants (sorted by type name): LineString(0), MultiLineString(1),
 * MultiPolygon(2), Point(3), Polygon(4), Ring(5); `0xFF` = NULL.
 */
export type GeometryValue =
  | readonly [discriminant: number, value: unknown]
  | null;

/**
 * Write a `Geometry`: a 1-byte discriminant then the chosen geo type's value. The
 * inverse of `readGeometry` (a switch over the discriminant with each branch
 * inlined). Takes a tagged {@link GeometryValue} because the value shapes are
 * ambiguous on their own.
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
