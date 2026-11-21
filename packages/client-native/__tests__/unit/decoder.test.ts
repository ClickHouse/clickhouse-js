import { describe, expect, it } from "vitest";
import { compressFrame } from "../../src/compression/frames";
import {
  BinaryReader,
  BinaryWriter,
  NeedMoreData,
} from "../../src/protocol/binary";
import type { DecodeContext, PendingBlock } from "../../src/protocol/columns";
import {
  decodeString,
  encodeText,
  readColumn,
  readPrefix,
} from "../../src/protocol/columns";
import type { Block } from "../../src/protocol/packets";
import {
  BLOCK_INFO,
  REVISION,
  ServerPacketType,
  readBlock,
  readServerPacket,
} from "../../src/protocol/packets";
import { parseColumnType } from "../../src/protocol/types";

const REV = REVISION.SERVER_QUERY_TIME_IN_PROGRESS;

function decode(typeName: string, bytes: number[], rows: number): unknown[] {
  const type = parseColumnType(typeName);
  const r = new BinaryReader(Buffer.from(bytes));
  const values = readColumn(r, type, rows, readPrefix(r, type), {
    timezone: "UTC",
  });
  expect(r.pos).toBe(bytes.length);
  return values;
}

/** A block with a fixed-size column, a String column and an Array column. */
function sampleBlock(rows: number): Buffer {
  const ids: number[] = [];
  const names: string[] = [];
  const tags: string[][] = [];
  for (let i = 0; i < rows; i++) {
    ids.push(i);
    names.push(`name-${i}-${"x".repeat(i % 7)}`);
    tags.push(i % 3 === 0 ? [] : [`t${i}`, "é"]);
  }
  const w = new BinaryWriter().raw(BLOCK_INFO).varuint(3).varuint(rows);
  const header = (name: string, type: string) =>
    w.string(name).string(type).u8(0); // no custom serialization
  header("id", "UInt32");
  for (const id of ids) w.u32(id);
  header("name", "String");
  for (const name of names) w.string(name);
  header("tags", "Array(String)");
  let offset = 0;
  for (const list of tags) w.u64((offset += list.length));
  for (const list of tags) for (const tag of list) w.string(tag);
  return w.toBuffer();
}

describe("[Native] type parser, special cases", () => {
  it("reads SKIP as an element name outside of JSON", () => {
    const t = parseColumnType("Tuple(SKIP UInt8, b String)");
    expect(t).toMatchObject({ kind: "Tuple", names: ["SKIP", "b"] });
    const nested = parseColumnType("Nested(SKIP UInt8, b String)");
    expect(nested.kind).toBe("Array");
  });

  it("keeps SKIP clauses of JSON", () => {
    const t = parseColumnType("JSON(a UInt8, SKIP b.c, SKIP REGEXP 'x.*')");
    expect(t).toMatchObject({ kind: "JSON" });
    if (t.kind !== "JSON") return;
    expect(t.typed_paths.map(([path]) => path)).toEqual(["a"]);
  });

  it("parses an empty tuple", () => {
    expect(parseColumnType("Tuple()")).toMatchObject({
      kind: "Tuple",
      elements: [],
    });
  });

  it("marks AggregateFunction with any arguments as not supported", () => {
    const name =
      "AggregateFunction(1, sumMapFiltered([1, 2]), Array(UInt8), Array(UInt8))";
    expect(parseColumnType(name)).toEqual({ kind: "Unsupported", name });
    expect(parseColumnType(`Array(${name})`)).toMatchObject({
      kind: "Array",
      inner: { kind: "Unsupported", name },
    });
  });
});

describe("[Native] column decoder, special cases", () => {
  it("reads one byte for each row of an empty tuple", () => {
    expect(decode("Tuple()", [0x30, 0x30, 0x30], 3)).toEqual([[], [], []]);
  });

  it("reads Array(Tuple()) and the column after it", () => {
    const type = parseColumnType("Array(Tuple())");
    const w = new BinaryWriter()
      .u64(2)
      .raw(Buffer.from([0x30, 0x30]))
      .u8(7);
    const r = new BinaryReader(w.toBuffer());
    expect(
      readColumn(r, type, 1, readPrefix(r, type), { timezone: "UTC" }),
    ).toEqual([[[], []]]);
    expect(r.u8()).toBe(7);
  });

  it("does not look up the Enum name of a NULL row", () => {
    // Rows: NULL (the stored number 0 is not a value of the Enum), 'a', NULL.
    expect(
      decode("Nullable(Enum8('a' = 1, 'b' = 2))", [1, 0, 1, 0, 1, 0], 3),
    ).toEqual([null, "a", null]);
  });

  it("rejects a number that is not a value of the Enum", () => {
    expect(() => decode("Enum8('a' = 1)", [0], 1)).toThrow(/Unknown value 0/);
    expect(() => decode("Nullable(Enum8('a' = 1))", [0, 0], 1)).toThrow(
      /Unknown value 0/,
    );
  });

  it("finds the end of a String column before it makes strings", () => {
    const type = parseColumnType("String");
    const full = new BinaryWriter().string("abc").string("defgh").toBuffer();
    for (let cut = 0; cut < full.length; cut++) {
      const r = new BinaryReader(full.subarray(0, cut));
      let needed = 0;
      try {
        readColumn(r, type, 2, undefined, { timezone: "UTC" });
      } catch (err) {
        expect(err).toBeInstanceOf(NeedMoreData);
        needed = (err as NeedMoreData).needed;
      }
      expect(needed).toBeGreaterThan(cut);
      expect(needed).toBeLessThanOrEqual(full.length);
      // The reader did not move: the caller can try again.
      expect(r.pos).toBe(0);
    }
    const r = new BinaryReader(full);
    expect(readColumn(r, type, 2, undefined, { timezone: "UTC" })).toEqual([
      "abc",
      "defgh",
    ]);
  });

  it.each([
    ["short ASCII", "a".repeat(127)],
    ["ASCII with a multi-byte length", "a".repeat(128)],
    ["UTF-8", "é😀"],
  ])(
    "reads %s from a sliced buffer and stops at the next column",
    (_label, value) => {
      const type = parseColumnType("String");
      const bytes = new BinaryWriter()
        .u8(0)
        .u8(1)
        .string("")
        .string("a\0b\x7f")
        .string(value)
        .u8(0xff)
        .toBuffer();
      const r = new BinaryReader(bytes.subarray(1), 1);
      const ctx: DecodeContext = { timezone: "UTC" };
      expect(readColumn(r, type, 3, undefined, ctx)).toEqual([
        "",
        "a\0b\x7f",
        value,
      ]);
      expect(ctx.raw_bytes).toBeUndefined();
      expect(r.u8()).toBe(0xff);
    },
  );

  it("keeps 64-bit limits at unaligned offsets in a sliced buffer", () => {
    const int64 = parseColumnType("Int64");
    const uint64 = parseColumnType("UInt64");
    const min = -(1n << 63n);
    const max = (1n << 64n) - 1n;
    const bytes = new BinaryWriter().u8(0).u8(1).i64(min).u64(max).toBuffer();
    const r = new BinaryReader(bytes.subarray(1), 1);
    const ctx: DecodeContext = { timezone: "UTC" };
    expect(readColumn(r, int64, 1, undefined, ctx)).toEqual([min]);
    expect(readColumn(r, uint64, 1, undefined, ctx)).toEqual([max]);
    expect(r.pos).toBe(r.buf.length);
  });

  it("decodes safe 64-bit integers as numbers when safe_int64 is enabled and keeps bigints beyond bounds", () => {
    const int64 = parseColumnType("Int64");
    const uint64 = parseColumnType("UInt64");
    const signedInputs = [
      -(1n << 63n),
      -(1n << 53n),
      -9007194959446016n, // hi = -0x1fffff, lo = 0
      -4294967296n,
      -1n,
      0n,
      42n,
      BigInt(Number.MAX_SAFE_INTEGER),
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      (1n << 63n) - 1n,
    ];
    const unsignedInputs = [
      0n,
      1n,
      0xffffffffn,
      BigInt(Number.MAX_SAFE_INTEGER),
      BigInt(Number.MAX_SAFE_INTEGER) + 1n,
      (1n << 64n) - 1n,
    ];
    const w = new BinaryWriter();
    for (const v of signedInputs) w.i64(v);
    for (const v of unsignedInputs) w.u64(v);
    const r = new BinaryReader(w.toBuffer());
    const ctx: DecodeContext = { timezone: "UTC", safe_int64: true };
    const decodedSigned = readColumn(
      r,
      int64,
      signedInputs.length,
      undefined,
      ctx,
    );
    const decodedUnsigned = readColumn(
      r,
      uint64,
      unsignedInputs.length,
      undefined,
      ctx,
    );
    expect(decodedSigned.map((v) => String(v))).toEqual(
      signedInputs.map((v) => String(v)),
    );
    expect(decodedUnsigned.map((v) => String(v))).toEqual(
      unsignedInputs.map((v) => String(v)),
    );
    expect(typeof decodedSigned[0]).toBe("bigint");
    expect(typeof decodedSigned[1]).toBe("bigint");
    expect(typeof decodedSigned[2]).toBe("number");
    expect(typeof decodedSigned[4]).toBe("number");
    expect(typeof decodedSigned[7]).toBe("number");
    expect(typeof decodedSigned[8]).toBe("bigint");
    expect(typeof decodedUnsigned[3]).toBe("number");
    expect(typeof decodedUnsigned[4]).toBe("bigint");
    expect(typeof decodedUnsigned[5]).toBe("bigint");
  });
});

describe("[Native] strings with bytes that are not UTF-8", () => {
  const roundTrip = (bytes: number[]): { text: string; raw: boolean } => {
    const ctx: DecodeContext = { timezone: "UTC" };
    const buf = Buffer.from(bytes);
    const text = decodeString(buf, 0, buf.length, ctx);
    expect([...encodeText(text)]).toEqual(bytes);
    return { text, raw: ctx.raw_bytes === true };
  };

  it("keeps valid UTF-8 as it is", () => {
    expect(roundTrip([...Buffer.from("héllo €😀")])).toEqual({
      text: "héllo €😀",
      raw: false,
    });
    // U+FFFD in the data is valid UTF-8.
    expect(roundTrip([0x61, 0xef, 0xbf, 0xbd])).toEqual({
      text: "a�",
      raw: false,
    });
  });

  it("keeps the bytes that are not UTF-8", () => {
    expect(roundTrip([0xff, 0x41, 0xc3])).toEqual({
      text: "\udcffA\udcc3",
      raw: true,
    });
  });

  it("keeps each single byte and each cut sequence", () => {
    for (let b = 0x80; b <= 0xff; b++) {
      expect(roundTrip([0x41, b, 0x42]).raw).toBe(true);
    }
    const cases = [
      [0xe2, 0x82], // a 3-byte sequence without its last byte
      [0xf0, 0x90, 0x80], // a 4-byte sequence without its last byte
      [0xc0, 0x80], // overlong
      [0xe0, 0x80, 0x80], // overlong
      [0xed, 0xa0, 0x80], // a UTF-16 surrogate
      [0xf4, 0x90, 0x80, 0x80], // above U+10FFFF
      [0xf8, 0x88, 0x80, 0x80, 0x80],
    ];
    for (const bytes of cases) {
      expect(roundTrip(bytes).raw).toBe(true);
      expect(roundTrip([...Buffer.from("é"), ...bytes, 0x7a]).raw).toBe(true);
    }
  });

  it("keeps random bytes", () => {
    let seed = 12345;
    const next = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff);
    for (let i = 0; i < 300; i++) {
      const bytes: number[] = [];
      const length = next() % 40;
      for (let j = 0; j < length; j++) bytes.push(next() % 256);
      roundTrip(bytes);
    }
  });

  it("does not change a low surrogate of a valid pair", () => {
    // U+10080 is the pair D800 DC80 in UTF-16.
    const text = "𐂀";
    expect(encodeText(text)).toEqual(Buffer.from(text, "utf8"));
  });

  it("sets the flag for String and FixedString columns", () => {
    const ctx: DecodeContext = { timezone: "UTC" };
    const r = new BinaryReader(Buffer.from([2, 0xff, 0x41]));
    expect(readColumn(r, parseColumnType("String"), 1, undefined, ctx)).toEqual(
      ["\udcffA"],
    );
    expect(ctx.raw_bytes).toBe(true);
    const fixed: DecodeContext = { timezone: "UTC" };
    const r2 = new BinaryReader(Buffer.from([0x41, 0xfe]));
    expect(
      readColumn(r2, parseColumnType("FixedString(2)"), 1, undefined, fixed),
    ).toEqual(["A\udcfe"]);
    expect(fixed.raw_bytes).toBe(true);
  });
});

describe("[Native] block reader that continues", () => {
  const rows = 50;
  const bytes = sampleBlock(rows);
  const expected = readBlock(new BinaryReader(bytes), REV, {
    timezone: "UTC",
  });

  it("gives the same block when the data comes at each byte offset", () => {
    expect(expected.rows).toBe(rows);
    expect(expected.columns.map((c) => c.name)).toEqual(["id", "name", "tags"]);
    for (let cut = 0; cut < bytes.length; cut++) {
      const state: PendingBlock = { column_count: 0, rows: 0, offset: 0 };
      const ctx: DecodeContext = { timezone: "UTC" };
      expect(() =>
        readBlock(new BinaryReader(bytes.subarray(0, cut)), REV, ctx, state),
      ).toThrow(NeedMoreData);
      const block = readBlock(new BinaryReader(bytes), REV, ctx, state);
      expect(block).toEqual(expected);
    }
  });

  it("does not decode a complete column again", () => {
    const state: PendingBlock = { column_count: 0, rows: 0, offset: 0 };
    const ctx: DecodeContext = { timezone: "UTC" };
    // All bytes but the last one: the first two columns are complete.
    expect(() =>
      readBlock(
        new BinaryReader(bytes.subarray(0, bytes.length - 1)),
        REV,
        ctx,
        state,
      ),
    ).toThrow(NeedMoreData);
    expect(state.columns?.map((c) => c.name)).toEqual(["id", "name"]);
    const decoded = state.columns?.[1]?.values;
    const block = readBlock(new BinaryReader(bytes), REV, ctx, state);
    // The same array: the reader kept the column.
    expect(block.columns[1]?.values).toBe(decoded);
    expect(block).toEqual(expected);
  });

  /** A Data packet. With `frameSize`, the block is in compressed blocks of
   *  that many bytes. */
  function dataPacket(frameSize?: number): Buffer {
    const head = new BinaryWriter()
      .varuint(ServerPacketType.Data)
      .string("")
      .toBuffer();
    if (frameSize === undefined) return Buffer.concat([head, bytes]);
    const frames: Buffer[] = [];
    for (let i = 0; i < bytes.length; i += frameSize) {
      frames.push(compressFrame(bytes.subarray(i, i + frameSize), "lz4"));
    }
    return Buffer.concat([head, ...frames]);
  }

  /** Reads the packet as a socket does: the data comes in chunks, and each
   *  try starts at the packet start with the same context. */
  function readInChunks(
    packet: Buffer,
    chunk: number,
    compressed: boolean,
    binaryColumns = false,
  ): { block: Block; tries: number } {
    const ctx: DecodeContext = {
      timezone: "UTC",
      compressed,
      binary_columns: { enabled: binaryColumns },
    };
    let tries = 0;
    for (let end = chunk; ; end += chunk) {
      const r = new BinaryReader(
        packet.subarray(0, Math.min(end, packet.length)),
      );
      tries++;
      try {
        const result = readServerPacket(r, REV, ctx);
        expect(r.pos).toBe(packet.length);
        expect(ctx.pending).toBeUndefined();
        if (result.type !== "data") throw new Error("Not a Data packet");
        return { block: result.block, tries };
      } catch (err) {
        if (!(err instanceof NeedMoreData)) throw err;
        expect(end).toBeLessThan(packet.length);
      }
    }
  }

  it("reads a packet that comes in chunks", () => {
    for (const chunk of [1, 7, 64, 1000]) {
      expect(readInChunks(dataPacket(), chunk, false).block).toEqual(expected);
    }
  });

  it("reads a block in many compressed blocks that come in chunks", () => {
    for (const frameSize of [16, 100, 4096]) {
      for (const chunk of [1, 13, 500]) {
        const { block } = readInChunks(dataPacket(frameSize), chunk, true);
        expect(block).toEqual(expected);
      }
    }
  });

  it.each([false, true])(
    "retains column bytes after the receive buffer is reused (compressed: %s)",
    (compressed) => {
      const packet = dataPacket(compressed ? 16 : undefined);
      const { block } = readInChunks(packet, 13, compressed, true);
      packet.fill(0);
      expect(
        block.columns.map((column) => column.binary !== undefined),
      ).toEqual([true, true, false]);
      expect(block.columns.map((column) => column.values)).toEqual(
        expected.columns.map((column) => column.values),
      );
    },
  );

  it("keeps the state apart for each packet", () => {
    const ctx: DecodeContext = { timezone: "UTC" };
    const packet = dataPacket();
    expect(() =>
      readServerPacket(
        new BinaryReader(packet.subarray(0, packet.length - 3)),
        REV,
        ctx,
      ),
    ).toThrow(NeedMoreData);
    expect(ctx.pending).toBeDefined();
    const two = Buffer.concat([packet, packet]);
    const r = new BinaryReader(two);
    expect(readServerPacket(r, REV, ctx)).toEqual({
      type: "data",
      block: expected,
    });
    expect(ctx.pending).toBeUndefined();
    expect(readServerPacket(r, REV, ctx)).toEqual({
      type: "data",
      block: expected,
    });
    expect(r.pos).toBe(two.length);
  });

  it("isolates Log and ProfileEvents packets from ctx.raw_bytes", () => {
    const badUtf8Block = new BinaryWriter()
      .raw(BLOCK_INFO)
      .varuint(1)
      .varuint(1)
      .string("text")
      .string("String")
      .u8(0)
      .bytes(Buffer.from([0xff, 0xfe]))
      .toBuffer();

    for (const packetType of [
      ServerPacketType.Log,
      ServerPacketType.ProfileEvents,
    ]) {
      const packet = Buffer.concat([
        new BinaryWriter().varuint(packetType).string("").toBuffer(),
        badUtf8Block,
      ]);
      const ctx: DecodeContext = { timezone: "UTC", raw_bytes: false };
      readServerPacket(new BinaryReader(packet), REV, ctx);
      expect(ctx.raw_bytes).toBe(false);
    }
  });

  it("snapshots DecodeContext for lazy binary columns", () => {
    const ctx: DecodeContext = {
      timezone: "UTC",
      binary_columns: { enabled: true },
    };
    const packet = dataPacket();
    const res = readServerPacket(new BinaryReader(packet), REV, ctx);
    if (res.type !== "data") throw new Error("Not a Data packet");

    // Mutate the context as a subsequent request on the same socket would.
    ctx.timezone = "Europe/Berlin";
    ctx.raw_bytes = true;

    expect(res.block.columns.map((c) => c.values)).toEqual(
      expected.columns.map((c) => c.values),
    );
  });

  it("consumes completed compressed frames incrementally when consume_frames is enabled", () => {
    for (const frameSize of [16, 100]) {
      const packet = dataPacket(frameSize);
      const ctx: DecodeContext = {
        timezone: "UTC",
        compressed: true,
        consume_frames: true,
      };
      let buf: Buffer = Buffer.alloc(0);
      let maxBuffered = 0;
      let consumedTotal = 0;
      let decoded: Block | undefined;
      for (let off = 0; off < packet.length; off += 13) {
        const chunk = packet.subarray(off, Math.min(off + 13, packet.length));
        buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
        maxBuffered = Math.max(maxBuffered, buf.length);
        const r = new BinaryReader(buf);
        try {
          const res = readServerPacket(r, REV, ctx);
          expect(r.pos).toBe(buf.length);
          expect(ctx.pending).toBeUndefined();
          if (res.type !== "data") throw new Error("Not a Data packet");
          decoded = res.block;
        } catch (err) {
          if (!(err instanceof NeedMoreData)) throw err;
          if (err.consumed > 0) {
            consumedTotal += err.consumed;
            buf = buf.subarray(err.consumed);
          }
        }
      }
      expect(decoded).toEqual(expected);
      expect(consumedTotal).toBeGreaterThan(0);
      expect(maxBuffered).toBeLessThan(packet.length);
    }
  });

  it("skips multi-column Log packets across chunked reads without setting raw_bytes", () => {
    const logBlock = new BinaryWriter()
      .raw(BLOCK_INFO)
      .varuint(4) // 4 columns
      .varuint(2) // 2 rows
      .string("ts")
      .string("DateTime")
      .u8(0)
      .u32(1700000000)
      .u32(1700000001)
      .string("msg")
      .string("String")
      .u8(0)
      .bytes(Buffer.from([0xff, 0xfe]))
      .string("ok")
      .string("opt")
      .string("Nullable(String)")
      .u8(0)
      .u8(1)
      .u8(0)
      .string("")
      .string("val")
      .string("arr")
      .string("Array(UInt32)")
      .u8(0)
      .u64(1)
      .u64(3)
      .u32(10)
      .u32(20)
      .u32(30)
      .toBuffer();

    const packet = Buffer.concat([
      new BinaryWriter().varuint(ServerPacketType.Log).string("").toBuffer(),
      logBlock,
    ]);
    const ctx: DecodeContext = { timezone: "UTC", raw_bytes: false };
    let done = false;
    for (let end = 5; ; end += 5) {
      const r = new BinaryReader(
        packet.subarray(0, Math.min(end, packet.length)),
      );
      try {
        const res = readServerPacket(r, REV, ctx);
        expect(res).toEqual({ type: "log" });
        expect(r.pos).toBe(packet.length);
        done = true;
        break;
      } catch (err) {
        if (!(err instanceof NeedMoreData)) throw err;
      }
    }
    expect(done).toBe(true);
    expect(ctx.raw_bytes).toBe(false);
    expect(ctx.pending).toBeUndefined();
  });

  it("decodes rejected binary String columns (long or non-UTF-8) in one pass", () => {
    const longStr = "x".repeat(200);
    const blockBytes = new BinaryWriter()
      .raw(BLOCK_INFO)
      .varuint(2)
      .varuint(2)
      .string("long_s")
      .string("String")
      .u8(0)
      .string(longStr)
      .string("short")
      .string("bad_utf8")
      .string("String")
      .u8(0)
      .bytes(Buffer.from([0xff, 0x41]))
      .string("ok")
      .toBuffer();

    const ctx: DecodeContext = {
      timezone: "UTC",
      binary_columns: { enabled: true },
    };
    const b = readBlock(
      new BinaryReader(blockBytes),
      REV,
      ctx,
      undefined,
      true,
    );
    expect(b.columns[0]?.binary).toBeUndefined();
    expect(b.columns[0]?.values).toEqual([longStr, "short"]);
    expect(b.columns[1]?.binary).toBeUndefined();
    expect(b.columns[1]?.values).toEqual([
      decodeString(Buffer.from([0xff, 0x41]), 0, 2, { timezone: "UTC" }),
      "ok",
    ]);
    expect(ctx.raw_bytes).toBe(true);
  });
});
