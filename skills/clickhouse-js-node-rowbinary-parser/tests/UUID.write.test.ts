import { describe, expect, it } from "vitest";
import { query } from "./clickhouse.js";
import { Cursor, Sink } from "../src/core.js";
import {
  readUUID,
  readUUIDBigInt,
  readUUIDHiLo,
  formatUUID,
  parseUUID,
} from "../src/uuid.js";
import {
  writeUUID,
  writeUUIDBigInt,
  writeUUIDHiLo,
} from "../src/uuid.js";

const SAMPLE = "61f0c404-5cb3-11e7-907b-a6006ad3dba0";

async function uuidBytes(): Promise<Buffer> {
  return query(`SELECT toUUID('${SAMPLE}') FORMAT RowBinary`);
}

describe("UUID writers", () => {
  it("writeUUID round-trips the raw bytes", async () => {
    const bytes = await uuidBytes();
    const value = readUUID(new Cursor(bytes));
    const sink = new Sink();
    writeUUID(sink, value);
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("writeUUIDBigInt round-trips", async () => {
    const bytes = await uuidBytes();
    const value = readUUIDBigInt(new Cursor(bytes));
    const sink = new Sink();
    writeUUIDBigInt(sink, value);
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("writeUUIDHiLo round-trips", async () => {
    const bytes = await uuidBytes();
    const value = readUUIDHiLo(new Cursor(bytes));
    const sink = new Sink();
    writeUUIDHiLo(sink, value);
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("parseUUID is the inverse of formatUUID and matches the wire", async () => {
    const bytes = await uuidBytes();
    expect(formatUUID(readUUID(new Cursor(bytes)))).toBe(SAMPLE);
    const sink = new Sink();
    writeUUID(sink, parseUUID(SAMPLE));
    expect(Buffer.from(sink.bytes())).toEqual(bytes);
  });

  it("writeUUID rejects non-16-byte input", () => {
    expect(() => writeUUID(new Sink(), Buffer.alloc(15))).toThrow(RangeError);
  });
});
