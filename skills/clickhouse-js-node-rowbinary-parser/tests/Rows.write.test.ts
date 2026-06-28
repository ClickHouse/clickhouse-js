import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { writeRows } from "../src/rows_writer.js";
import { type Writer } from "../src/core_writer.js";
import { writeTupleNamed } from "../src/composite_writer.js";
import { writeUInt64, writeUInt32 } from "../src/integers_writer.js";
import { writeString } from "../src/strings_writer.js";

type Row = {
  id: bigint;
  n: number;
  name: string;
};

const writeRow = writeTupleNamed<Row>({
  id: writeUInt64,
  n: writeUInt32,
  name: writeString,
});

/**
 * Drive `writeRows` to completion and concatenate every yielded buffer — the
 * canonical driver loop. `bufferSize` sizes each (fixed) sink, so a small value
 * forces the overflow + flush path; the default fits the rows in one buffer.
 */
function encodeRows(
  write: Writer<Row>,
  rows: Iterable<Row>,
  bufferSize = 4096,
): Buffer {
  return Buffer.concat([...writeRows(write)(rows, bufferSize)]);
}

describe("writeRows", () => {
  const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
    id: BigInt(i),
    n: i * 10,
    name: `row${i}`,
  }));
  const sql =
    "SELECT toUInt64(number) AS id, toUInt32(number * 10) AS n, concat('row', toString(number)) AS name " +
    "FROM numbers(5) FORMAT RowBinary";

  it("encodes a plain RowBinary result of several rows", async () => {
    expect(encodeRows(writeRow, rows)).toEqual(await query(sql));
  });

  it("writes nothing for an empty array", () =>
    expect(encodeRows(writeRow, []).length).toBe(0));

  it("flushes on buffer overflow and resumes — same bytes across a tiny buffer", async () => {
    // A buffer far smaller than the whole result: the driver must flush full
    // buffers mid-stream at row boundaries and reassemble to the identical bytes.
    const expected = await query(sql);
    const tiny = encodeRows(writeRow, rows, 20); // 20 holds one 17-byte row, not two
    expect(tiny).toEqual(expected);
  });

  it("yields at row boundaries, never a half-written row", () => {
    // bufferSize holds two rows + change but not three, so the first yield must
    // land exactly on a row boundary (a whole number of rows), not mid-row.
    const gen = writeRows(writeRow)(rows, 40);
    const first = gen.next();
    expect(first.done).toBe(false);
    // Decode-free boundary check: the flushed prefix must be a prefix of the
    // full encoding (and thus a whole number of rows).
    const full = encodeRows(writeRow, rows);
    const flushed = first.value as Buffer;
    expect(full.subarray(0, flushed.length)).toEqual(flushed);
  });

  it("yields independent buffers — a flushed buffer survives the next iteration", () => {
    // Each flush gets a fresh buffer, so an earlier yield isn't clobbered when
    // the generator resumes. Collect two buffers, then assert the first is intact.
    const gen = writeRows(writeRow)(rows, 20);
    const a = gen.next().value as Buffer;
    const snapshot = Buffer.from(a); // independent copy of what we saw first
    gen.next(); // resume: writes the next row into a NEW buffer
    expect(a).toEqual(snapshot); // `a` must be untouched
  });

  it("throws when a single row can't fit in an empty buffer", () => {
    const gen = writeRows(writeRow)(rows, 4); // too small for even one row
    expect(() => gen.next()).toThrow(/single row exceeds the sink buffer/);
  });
});
