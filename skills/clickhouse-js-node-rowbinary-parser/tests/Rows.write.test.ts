import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { encode } from "./encode.js";
import { writeRows } from "../src/rows_writer.js";
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

describe("writeRows", () => {
  it("encodes a plain RowBinary result of several rows", async () => {
    const rows: Row[] = Array.from({ length: 5 }, (_, i) => ({
      id: BigInt(i),
      n: i * 10,
      name: `row${i}`,
    }));
    expect(encode(writeRows(writeRow), rows)).toEqual(
      await query(
        "SELECT toUInt64(number) AS id, toUInt32(number * 10) AS n, concat('row', toString(number)) AS name " +
          "FROM numbers(5) FORMAT RowBinary",
      ),
    );
  });

  it("writes nothing for an empty array", () =>
    expect(encode(writeRows(writeRow), []).length).toBe(0));
});
