import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import { readRows } from "../src/rows.js";
import { writeRows } from "../src/rows.js";
import { readTupleNamed } from "../src/composite.js";
import { writeTupleNamed } from "../src/composite.js";
import { readUInt64, readUInt32 } from "../src/integers.js";
import { writeUInt64, writeUInt32 } from "../src/integers.js";
import { readString } from "../src/strings.js";
import { writeString } from "../src/strings.js";

type Row = {
  id: bigint;
  n: number;
  name: string;
};

const readRow = readTupleNamed<Row>({
  id: readUInt64,
  n: readUInt32,
  name: readString,
});
const writeRow = writeTupleNamed<Row>({
  id: writeUInt64,
  n: writeUInt32,
  name: writeString,
});

describe("writeRows", () => {
  it("round-trips a plain RowBinary result of several rows", async () => {
    const bytes = await query(
      "SELECT toUInt64(number) AS id, toUInt32(number * 10) AS n, concat('row', toString(number)) AS name " +
        "FROM numbers(5) FORMAT RowBinary",
    );
    const rows = readRows(readRow)(new Cursor(bytes));
    expect(rows.length).toBe(5);
    const sink = new Sink();
    writeRows(writeRow)(sink, rows);
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("writes nothing for an empty array", () => {
    const sink = new Sink();
    writeRows(writeRow)(sink, []);
    expect(sink.bytes().length).toBe(0);
  });
});
