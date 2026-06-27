import { describe, expect, it } from "vitest";
import { Cursor, Sink, reserve } from "../src/core.js";
import { readUVarint } from "../src/varint.js";
import { writeUVarint } from "../src/varint.js";

describe("Sink / reserve", () => {
  it("reserve advances and returns the start offset", () => {
    const s = new Sink(8);
    expect(reserve(s, 4)).toBe(0);
    expect(reserve(s, 2)).toBe(4);
    expect(s.pos).toBe(6);
  });

  it("grows the backing buffer past its initial capacity", () => {
    const s = new Sink(4);
    const start = reserve(s, 10); // forces a grow
    expect(start).toBe(0);
    expect(s.buf.length).toBeGreaterThanOrEqual(10);
    expect(s.pos).toBe(10);
  });

  it("preserves already-written bytes across a grow", () => {
    const s = new Sink(2);
    let o = reserve(s, 1);
    s.buf[o] = 0xaa;
    o = reserve(s, 1);
    s.buf[o] = 0xbb;
    o = reserve(s, 1); // triggers a grow
    s.buf[o] = 0xcc;
    expect([...s.bytes()]).toEqual([0xaa, 0xbb, 0xcc]);
  });

  it("bytes() returns only the written prefix", () => {
    const s = new Sink(64);
    const o = reserve(s, 1);
    s.buf[o] = 0x01;
    expect(s.bytes().length).toBe(1);
  });
});

describe("writeUVarint", () => {
  // The byte-width boundaries of LEB128, mirroring readUVarint's coverage.
  const cases = [0, 1, 127, 128, 16383, 16384, 2097151, 2097152];
  for (const n of cases) {
    it(`round-trips ${n}`, () => {
      const s = new Sink();
      writeUVarint(s, n);
      const bytes = s.bytes();
      // Re-decode with the reader: writeUVarint must be readUVarint's inverse.
      expect(readUVarint(new Cursor(Buffer.from(bytes)))).toBe(n);
    });
  }

  it("encodes 0 as a single 0x00 byte", () => {
    const s = new Sink();
    writeUVarint(s, 0);
    expect([...s.bytes()]).toEqual([0x00]);
  });

  it("encodes 300 as a 2-byte LEB128 [0xac, 0x02]", () => {
    const s = new Sink();
    writeUVarint(s, 300);
    expect([...s.bytes()]).toEqual([0xac, 0x02]);
  });

  it("round-trips Number.MAX_SAFE_INTEGER (2^53 - 1)", () => {
    const s = new Sink();
    writeUVarint(s, Number.MAX_SAFE_INTEGER);
    expect([...s.bytes()]).toEqual([
      0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f,
    ]);
  });

  it("throws for negative, fractional, or too-large values", () => {
    const s = new Sink();
    expect(() => writeUVarint(s, -1)).toThrow(RangeError);
    expect(() => writeUVarint(s, 1.5)).toThrow(RangeError);
    expect(() => writeUVarint(s, Number.MAX_SAFE_INTEGER + 1)).toThrow(
      RangeError,
    );
  });
});
