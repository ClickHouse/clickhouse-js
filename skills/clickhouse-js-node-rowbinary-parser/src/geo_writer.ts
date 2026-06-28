import { type Writer, Sink, reserve } from "./core_writer.js";
import { type Point } from "./geo.js";
import { writeUInt8 } from "./integers_writer.js";
import { writeUVarint } from "./varint_writer.js";

/**
 * Write a `Point`: `Tuple(Float64, Float64)` -> `[x, y]`. Inverse of `readPoint`.
 * A single `reserve(16)` then two inlined `setFloat64`s — no per-coordinate
 * `writeFloat64` call and only one bounds check.
 */
export function writePoint(sink: Sink, [x, y]: Point): void {
  const o = reserve(sink, 16);
  sink.view.setFloat64(o, x, true);
  sink.view.setFloat64(o + 8, y, true);
}

/**
 * Write a `Ring`: `Array(Point)` — a LEB128 point count, then each point. The
 * inverse of `readRing`; a SINGLE `reserve(16 * length)` covers the whole point
 * block (one bounds check per ring, not per point), then the coordinates are
 * written into it inline, mirroring the reader.
 */
export function writeRing(sink: Sink, points: readonly Point[]): void {
  writeUVarint(sink, points.length);
  const o = reserve(sink, points.length * 16);
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]!;
    const p = o + i * 16;
    sink.view.setFloat64(p, x, true);
    sink.view.setFloat64(p + 8, y, true);
  }
}

/** Write a `LineString`: `Array(Point)` (identical wire to a `Ring`). Inverse of `readLineString`. */
export function writeLineString(sink: Sink, points: readonly Point[]): void {
  writeUVarint(sink, points.length);
  const o = reserve(sink, points.length * 16);
  for (let i = 0; i < points.length; i++) {
    const [x, y] = points[i]!;
    const p = o + i * 16;
    sink.view.setFloat64(p, x, true);
    sink.view.setFloat64(p + 8, y, true);
  }
}

/** Write a `Polygon`: `Array(Ring)` — outer ring first, then holes. Inverse of `readPolygon`. */
export function writePolygon(sink: Sink, rings: readonly Point[][]): void {
  writeUVarint(sink, rings.length);
  for (let i = 0; i < rings.length; i++) writeRing(sink, rings[i]!);
}

/** Write a `MultiLineString`: `Array(LineString)`. Inverse of `readMultiLineString`. */
export function writeMultiLineString(
  sink: Sink,
  lines: readonly Point[][],
): void {
  writeUVarint(sink, lines.length);
  for (let i = 0; i < lines.length; i++) writeLineString(sink, lines[i]!);
}

/** Write a `MultiPolygon`: `Array(Polygon)`. Inverse of `readMultiPolygon`. */
export function writeMultiPolygon(
  sink: Sink,
  polygons: readonly Point[][][],
): void {
  writeUVarint(sink, polygons.length);
  for (let i = 0; i < polygons.length; i++) writePolygon(sink, polygons[i]!);
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
  readonly [discriminant: number, value: unknown] | null;

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
