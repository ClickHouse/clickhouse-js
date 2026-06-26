import { describe, expect, it } from "vitest";
import { Cursor } from "../src/core.js";
import { readHeader } from "../src/header.js";
import { Writer, header } from "./rowBinaryWriter.js";

describe("readHeader", () => {
  it("reads column count, names, then types and stops at the first row", () => {
    const w = header(new Writer(), ["id", "name"], ["UInt32", "String"]);
    w.u32(7).string("x"); // one row, so we can check the cursor lands on it
    const s = new Cursor(w.done());

    expect(readHeader(s)).toEqual({
      names: ["id", "name"],
      types: ["UInt32", "String"],
    });
    // Cursor now points at the row payload.
    expect(s.buf.readUInt32LE(s.pos)).toBe(7);
  });
});
