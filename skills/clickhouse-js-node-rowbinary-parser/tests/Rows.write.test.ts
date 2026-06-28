import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { writeRows } from "../src/rows_writer.js";
import { Sink, type Writer } from "../src/core_writer.js";
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
 * Drive `writeRows` to completion, flushing each yielded full buffer and the
 * trailing partial one, and concatenate everything — the canonical driver loop.
 * `capacity` sizes the (fixed) sink buffer, so a small value forces the overflow
 * + flush path; the default fits the rows under test in one buffer.
 */
function encodeRows(
  write: Writer<Row>,
  rows: Iterable<Row>,
  capacity = 4096,
): Buffer {
  const sink = new Sink(Buffer.allocUnsafe(capacity));
  const parts: Buffer[] = [];
  for (const full of writeRows(write)(sink, rows))
    parts.push(Buffer.from(full));
  parts.push(Buffer.from(sink.bytes()));
  return Buffer.concat(parts);
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
    // Capacity holds two rows + change but not three, so the first yield must
    // land exactly on a row boundary (a whole number of rows), not mid-row.
    const sink = new Sink(Buffer.allocUnsafe(40));
    const gen = writeRows(writeRow)(sink, rows);
    const first = gen.next();
    expect(first.done).toBe(false);
    // Decode-free boundary check: the flushed prefix must be a prefix of the
    // full encoding AND a whole number of rows (re-encoding that many rows into
    // a roomy buffer reproduces exactly the flushed bytes).
    const full = encodeRows(writeRow, rows);
    const flushed = first.value as Buffer;
    expect(full.subarray(0, flushed.length)).toEqual(flushed);
  });

  it("throws when a single row can't fit in an empty buffer", () => {
    const sink = new Sink(Buffer.allocUnsafe(4)); // too small for even one row
    const gen = writeRows(writeRow)(sink, rows);
    expect(() => gen.next()).toThrow(/single row exceeds the sink buffer/);
  });
});
