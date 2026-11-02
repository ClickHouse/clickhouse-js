import { describe, expect, it } from "vitest";
import { readMap, readMapEntries } from "../src/readers/composite.js";
import { Cursor } from "../src/readers/core.js";
import { readDynamic } from "../src/readers/dynamic.js";
import { readString } from "../src/readers/strings.js";
import { typeStringToReader } from "../src/readers/rowBinaryWithNamesAndTypes.js";

// `SELECT CAST(map('key', 'X', 'key', 'Y') AS Map(String, String)) FORMAT
// RowBinary`, a map whose two pairs share a key, which ClickHouse allows. The
// wire is a LEB128 pair count, then (key, value) pairs interleaved:
//   0x02                 count = 2
//   0x03 'k' 'e' 'y'     key "key"
//   0x01 'X'             value "X"
//   0x03 'k' 'e' 'y'     key "key" (again)
//   0x01 'Y'             value "Y"
// 13 bytes total. Hand-written so the test needs no live ClickHouse server.
const DUP_KEY_MAP = Buffer.from([
  0x02, 0x03, 0x6b, 0x65, 0x79, 0x01, 0x58, 0x03, 0x6b, 0x65, 0x79, 0x01, 0x59,
]);

describe("readMapEntries", () => {
  it("keeps both pairs of a map whose pairs share a key", () => {
    const r = new Cursor(DUP_KEY_MAP);
    expect(readMapEntries(readString, readString)(r)).toEqual([
      ["key", "X"],
      ["key", "Y"],
    ]);
    expect(r.pos).toBe(13);
  });

  it("decodes the empty map to an empty pair list", () => {
    const r = new Cursor(Buffer.from([0x00]));
    expect(readMapEntries(readString, readString)(r)).toEqual([]);
    expect(r.pos).toBe(1);
  });
});

describe("readMap", () => {
  it("still returns a JS Map for the same bytes (repeated key collapses)", () => {
    const r = new Cursor(DUP_KEY_MAP);
    expect(readMap(readString, readString)(r)).toEqual(new Map([["key", "Y"]]));
    expect(r.pos).toBe(13);
  });

  it("is unchanged for maps with unique keys", () => {
    // map('a', 'b'): count 1, key "a", value "b".
    const r = new Cursor(Buffer.from([0x01, 0x01, 0x61, 0x01, 0x62]));
    expect(readMap(readString, readString)(r)).toEqual(new Map([["a", "b"]]));
    expect(r.pos).toBe(5);
  });
});

describe("Map as pair list in the schema-driven readers", () => {
  it("keeps duplicates for a top-level Map(String, String)", () => {
    const r = new Cursor(DUP_KEY_MAP);
    const read = typeStringToReader("Map(String, String)", {
      mapAsEntries: true,
    });
    expect(read(r)).toEqual([
      ["key", "X"],
      ["key", "Y"],
    ]);
    expect(r.pos).toBe(13);
  });

  it("keeps duplicates for a map nested in an Array", () => {
    // Array(Map(String, String)): one element, the map above.
    const r = new Cursor(Buffer.concat([Buffer.from([0x01]), DUP_KEY_MAP]));
    const read = typeStringToReader("Array(Map(String, String))", {
      mapAsEntries: true,
    });
    expect(read(r)).toEqual([
      [
        ["key", "X"],
        ["key", "Y"],
      ],
    ]);
    expect(r.pos).toBe(14);
  });

  it("keeps duplicates for a map nested in a Map value", () => {
    // Map(String, Map(String, String)): one pair, key "k", value the map above.
    const r = new Cursor(
      Buffer.concat([Buffer.from([0x01, 0x01, 0x6b]), DUP_KEY_MAP]),
    );
    const read = typeStringToReader("Map(String, Map(String, String))", {
      mapAsEntries: true,
    });
    expect(read(r)).toEqual([
      [
        "k",
        [
          ["key", "X"],
          ["key", "Y"],
        ],
      ],
    ]);
    expect(r.pos).toBe(16);
  });

  it("defaults to the Map shape when the option is omitted", () => {
    const r = new Cursor(DUP_KEY_MAP);
    expect(typeStringToReader("Map(String, String)")(r)).toEqual(
      new Map([["key", "Y"]]),
    );
    expect(r.pos).toBe(13);
  });

  it("keeps duplicates for a Map inside a Dynamic value", () => {
    // Dynamic type encoding: tag 0x27 (Map), key type 0x15 (String), value type
    // 0x15 (String), then the value bytes as above.
    const r = new Cursor(
      Buffer.concat([Buffer.from([0x27, 0x15, 0x15]), DUP_KEY_MAP]),
    );
    expect(readDynamic(r, { mapAsEntries: true })).toEqual([
      ["key", "X"],
      ["key", "Y"],
    ]);
    expect(r.pos).toBe(16);
  });
});
