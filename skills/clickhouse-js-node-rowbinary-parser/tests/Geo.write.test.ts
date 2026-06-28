import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import {
  writePoint,
  writeRing,
  writeLineString,
  writePolygon,
  writeMultiLineString,
  writeMultiPolygon,
  writeGeometry,
} from "../src/geo_writer.js";
import { type Point } from "../src/geo.js";

const ring: Point[] = [
  [0, 0],
  [1, 2],
];
const polygon: Point[][] = [
  [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
];

describe("geo writers", () => {
  it("encodes a Point", async () =>
    expect(encode(writePoint, [1.5, 2.5])).toEqual(
      await query("SELECT CAST((1.5, 2.5) AS Point) FORMAT RowBinary"),
    ));
  it("encodes a Ring", async () =>
    expect(encode(writeRing, ring)).toEqual(
      await query("SELECT CAST([(0, 0), (1, 2)] AS Ring) FORMAT RowBinary"),
    ));
  it("encodes a LineString", async () =>
    expect(encode(writeLineString, ring)).toEqual(
      await query(
        "SELECT CAST([(0, 0), (1, 2)] AS LineString) FORMAT RowBinary",
      ),
    ));
  it("encodes a Polygon", async () =>
    expect(encode(writePolygon, polygon)).toEqual(
      await query(
        "SELECT CAST([[(0, 0), (1, 0), (1, 1)]] AS Polygon) FORMAT RowBinary",
      ),
    ));
  it("encodes a MultiLineString", async () =>
    expect(
      encode(writeMultiLineString, [
        [
          [0, 0],
          [1, 2],
        ],
        [[3, 4]],
      ]),
    ).toEqual(
      await query(
        "SELECT CAST([[(0, 0), (1, 2)], [(3, 4)]] AS MultiLineString) FORMAT RowBinary",
      ),
    ));
  it("encodes a MultiPolygon", async () =>
    expect(encode(writeMultiPolygon, [polygon])).toEqual(
      await query(
        "SELECT CAST([[[(0, 0), (1, 0), (1, 1)]]] AS MultiPolygon) FORMAT RowBinary",
      ),
    ));
});

describe("writeGeometry", () => {
  /** Encode a tagged Geometry value and match ClickHouse's `Geometry`. */
  function geometryBytes(expr: string): Promise<Buffer> {
    return query(
      `SELECT CAST(${expr} AS Geometry) SETTINGS allow_suspicious_variant_types = 1 FORMAT RowBinary`,
    );
  }

  it("encodes a Point (discriminant 3)", async () =>
    expect(encode(writeGeometry, [3, [1.5, 2.5]])).toEqual(
      await geometryBytes("CAST((1.5, 2.5) AS Point)"),
    ));
  it("encodes a LineString (discriminant 0)", async () =>
    expect(encode(writeGeometry, [0, ring])).toEqual(
      await geometryBytes("CAST([(0, 0), (1, 2)] AS LineString)"),
    ));
  it("encodes a Polygon (discriminant 4)", async () =>
    expect(encode(writeGeometry, [4, polygon])).toEqual(
      await geometryBytes("CAST([[(0, 0), (1, 0), (1, 1)]] AS Polygon)"),
    ));
  it("encodes NULL as a single 0xFF byte", () =>
    expect([...encode(writeGeometry, null)]).toEqual([0xff]));
});
