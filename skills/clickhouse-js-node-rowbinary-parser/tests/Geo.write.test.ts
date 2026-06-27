import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import {
  readPoint,
  readRing,
  readLineString,
  readPolygon,
  readMultiLineString,
  readMultiPolygon,
  readGeometry,
} from "../src/geo.js";
import {
  writePoint,
  writeRing,
  writeLineString,
  writePolygon,
  writeMultiLineString,
  writeMultiPolygon,
  writeGeometry,
  type GeometryValue,
} from "../src/geo.js";
import { readUInt8 } from "../src/integers.js";

function rt<T>(
  bytes: Buffer,
  read: (c: Cursor) => T,
  write: (s: Sink, v: T) => void,
): Buffer {
  const value = read(new Cursor(bytes));
  const sink = new Sink();
  write(sink, value);
  return Buffer.from(sink.bytes());
}

describe("geo writers", () => {
  const cases: Array<{ name: string; expr: string; read: (c: Cursor) => unknown; write: (s: Sink, v: never) => void }> = [
    { name: "Point", expr: "CAST((1.5, 2.5) AS Point)", read: readPoint, write: writePoint as never },
    { name: "Ring", expr: "CAST([(0, 0), (1, 2)] AS Ring)", read: readRing, write: writeRing as never },
    { name: "LineString", expr: "CAST([(0, 0), (1, 2)] AS LineString)", read: readLineString, write: writeLineString as never },
    { name: "Polygon", expr: "CAST([[(0, 0), (1, 0), (1, 1)]] AS Polygon)", read: readPolygon, write: writePolygon as never },
    { name: "MultiLineString", expr: "CAST([[(0, 0), (1, 2)], [(3, 4)]] AS MultiLineString)", read: readMultiLineString, write: writeMultiLineString as never },
    { name: "MultiPolygon", expr: "CAST([[[(0, 0), (1, 0), (1, 1)]]] AS MultiPolygon)", read: readMultiPolygon, write: writeMultiPolygon as never },
  ];
  for (const c of cases) {
    it(`round-trips ${c.name}`, async () => {
      const bytes = await query(`SELECT ${c.expr} FORMAT RowBinary`);
      expect(rt(bytes, c.read, c.write as (s: Sink, v: unknown) => void)).toEqual(bytes);
    });
  }
});

describe("writeGeometry", () => {
  it("round-trips each alternative (tagged with its discriminant)", async () => {
    const exprs = [
      "CAST((1.5, 2.5) AS Point)",
      "CAST([(0, 0), (1, 2)] AS LineString)",
      "CAST([[(0, 0), (1, 0), (1, 1)]] AS Polygon)",
    ];
    for (const expr of exprs) {
      const bytes = await query(
        `SELECT CAST(${expr} AS Geometry) SETTINGS allow_suspicious_variant_types = 1 FORMAT RowBinary`,
      );
      // Peek the discriminant, decode the value with readGeometry, re-encode tagged.
      const d = readUInt8(new Cursor(bytes));
      const value = readGeometry(new Cursor(bytes));
      const tagged: GeometryValue = [d, value];
      const sink = new Sink();
      writeGeometry(sink, tagged);
      expect(Buffer.from(sink.bytes())).toEqual(bytes);
    }
  });

  it("writes NULL as a single 0xFF byte", () => {
    const sink = new Sink();
    writeGeometry(sink, null);
    expect([...sink.bytes()]).toEqual([0xff]);
  });
});
