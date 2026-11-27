import { describe, expect, it } from "vitest";
import {
  BinaryReader,
  BinaryWriter,
  MAX_BYTES_LENGTH,
  NeedMoreData,
  ProtocolError,
} from "../../src/protocol/binary";
import { readColumn, readPrefix } from "../../src/protocol/columns";
import {
  REVISION,
  ServerPacketType,
  readServerPacket,
} from "../../src/protocol/packets";
import {
  formatDate,
  formatDateTime,
  formatDateTime64,
  formatDecimal,
  formatIPv6,
  formatTime,
  formatUUID,
} from "../../src/protocol/text";
import { compareBytes, parseColumnType } from "../../src/protocol/types";

describe("[Native] type parser", () => {
  it("parses simple and parametric types", () => {
    expect(parseColumnType("UInt64")).toMatchObject({
      kind: "Int",
      bits: 64,
      signed: false,
    });
    expect(parseColumnType("Decimal(18, 4)")).toMatchObject({
      kind: "Decimal",
      bytes: 8,
      scale: 4,
    });
    expect(parseColumnType("Decimal128(3)")).toMatchObject({
      kind: "Decimal",
      bytes: 16,
      scale: 3,
    });
    expect(parseColumnType("DateTime64(6, 'Europe/Berlin')")).toMatchObject({
      kind: "DateTime64",
      precision: 6,
      timezone: "Europe/Berlin",
    });
    expect(parseColumnType("FixedString(16)")).toMatchObject({
      kind: "FixedString",
      size: 16,
    });
  });

  it("parses enums with quotes and negative values", () => {
    const t = parseColumnType("Enum8('a' = -1, 'it\\'s' = 2, 'x,y' = 3)");
    expect(t.kind).toBe("Enum");
    if (t.kind !== "Enum") return;
    expect([...t.values.entries()]).toEqual([
      [-1, "a"],
      [2, "it's"],
      [3, "x,y"],
    ]);
  });

  it("parses nested and named types", () => {
    const t = parseColumnType(
      "Tuple(a LowCardinality(Nullable(String)), `b c` Array(Map(String, UInt8)))",
    );
    expect(t).toMatchObject({
      kind: "Tuple",
      names: ["a", "b c"],
      elements: [
        {
          kind: "LowCardinality",
          inner: { kind: "Nullable", inner: { kind: "String" } },
        },
        { kind: "Array", inner: { kind: "Map", key: { kind: "String" } } },
      ],
    });
    expect(parseColumnType("Tuple(UInt8, String)")).toMatchObject({
      kind: "Tuple",
      names: undefined,
    });
  });

  it("parses Nested as an array of named tuples", () => {
    expect(parseColumnType("Nested(k String, v UInt32)")).toMatchObject({
      kind: "Array",
      inner: { kind: "Tuple", names: ["k", "v"] },
    });
  });

  it("parses JSON with typed paths and skip clauses", () => {
    const t = parseColumnType(
      "JSON(max_dynamic_paths = 10, b.c UInt32, `a b` String, SKIP x.y, SKIP REGEXP '^z')",
    );
    expect(t).toMatchObject({
      kind: "JSON",
      typed_paths: [
        ["a b", { kind: "String" }],
        ["b.c", { kind: "Int", bits: 32 }],
      ],
    });
  });

  it("parses SimpleAggregateFunction as its stored type", () => {
    expect(
      parseColumnType("SimpleAggregateFunction(anyLast, Nullable(String))"),
    ).toMatchObject({
      kind: "Nullable",
      name: "SimpleAggregateFunction(anyLast, Nullable(String))",
    });
  });

  it("parses geo types and intervals", () => {
    expect(parseColumnType("Point")).toMatchObject({
      kind: "Tuple",
      name: "Point",
    });
    expect(parseColumnType("IntervalSecond")).toMatchObject({
      kind: "Int",
      bits: 64,
    });
  });

  it("marks types that the client cannot decode", () => {
    expect(parseColumnType("AggregateFunction(uniq, UInt64)")).toMatchObject({
      kind: "Unsupported",
    });
  });
});

describe("[Native] binary reader", () => {
  it("reads VarUInt values", () => {
    const buf = new BinaryWriter()
      .varuint(0)
      .varuint(127)
      .varuint(128)
      .varuint(2 ** 40)
      .toBuffer();
    const r = new BinaryReader(buf);
    expect([r.varuint(), r.varuint(), r.varuint(), r.varuint()]).toEqual([
      0,
      127,
      128,
      2 ** 40,
    ]);
  });

  it("throws NeedMoreData with the needed length", () => {
    const r = new BinaryReader(Buffer.from([1, 2]));
    let err: unknown;
    try {
      r.u64();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(NeedMoreData);
    expect((err as NeedMoreData).needed).toBe(8);
  });
});

describe("[Native] column decoder", () => {
  const ctx = { timezone: "UTC" };

  function decode(type: string, data: Buffer, rows: number): unknown[] {
    const t = parseColumnType(type);
    const r = new BinaryReader(data);
    const state = readPrefix(r, t);
    const values = readColumn(r, t, rows, state, ctx);
    expect(r.pos).toBe(data.length);
    return values;
  }

  it("decodes Nullable(Int32)", () => {
    const data = Buffer.alloc(2 + 8);
    data[1] = 1; // second row is NULL
    data.writeInt32LE(-5, 2);
    expect(decode("Nullable(Int32)", data, 2)).toEqual([-5, null]);
  });

  it("decodes Array(String)", () => {
    const w = new BinaryWriter()
      .u64(2)
      .u64(3)
      .string("a")
      .string("b")
      .string("c");
    expect(decode("Array(String)", w.toBuffer(), 2)).toEqual([
      ["a", "b"],
      ["c"],
    ]);
  });

  it("decodes LowCardinality(Nullable(String))", () => {
    const w = new BinaryWriter()
      .u64(1) // keys version
      .u64((1 << 9) | 0) // has additional keys, UInt8 indexes
      .u64(2) // keys
      .string("") // the NULL key
      .string("x")
      .u64(3) // indexes
      .u8(1)
      .u8(0)
      .u8(1);
    expect(decode("LowCardinality(Nullable(String))", w.toBuffer(), 3)).toEqual(
      ["x", null, "x"],
    );
  });

  it("decodes Int128 and UInt256", () => {
    const i128 = Buffer.alloc(16, 0xff); // -1
    expect(decode("Int128", i128, 1)).toEqual([-1n]);
    const u256 = Buffer.alloc(32);
    u256[0] = 1;
    u256[31] = 0x80;
    expect(decode("UInt256", u256, 1)).toEqual([(1n << 255n) + 1n]);
  });
});

describe("[Native] value text", () => {
  it("formats dates and times", () => {
    expect(formatDate(0)).toBe("1970-01-01");
    expect(formatDate(-25567)).toBe("1900-01-01");
    expect(formatDateTime(0, "UTC")).toBe("1970-01-01 00:00:00");
    expect(formatDateTime(1704067200, "Asia/Kolkata")).toBe(
      "2024-01-01 05:30:00",
    );
    // Daylight saving time in Berlin starts at 2024-03-31 01:00 UTC.
    expect(formatDateTime(1711846799, "Europe/Berlin")).toBe(
      "2024-03-31 01:59:59",
    );
    expect(formatDateTime(1711846800, "Europe/Berlin")).toBe(
      "2024-03-31 03:00:00",
    );
    expect(formatDateTime64(-877n, 3, "UTC")).toBe("1969-12-31 23:59:59.123");
    expect(formatTime(-3600)).toBe("-01:00:00");
    expect(formatTime(360000)).toBe("100:00:00");
  });

  it("formats decimals", () => {
    expect(formatDecimal(15000n, 4, false)).toBe("1.5");
    expect(formatDecimal(15000n, 4, true)).toBe("1.5000");
    expect(formatDecimal(-5n, 3, false)).toBe("-0.005");
    expect(formatDecimal(0n, 2, false)).toBe("0");
    expect(formatDecimal(42n, 0, false)).toBe("42");
  });

  it("formats UUID and IPv6 values", () => {
    const uuid = Buffer.from("e711b35c04c4f061a0dbd36a00a67b90", "hex");
    expect(formatUUID(uuid, 0)).toBe("61f0c404-5cb3-11e7-907b-a6006ad3dba0");
    const ip = (s: string) => Buffer.from(s.replace(/:/g, ""), "hex");
    expect(formatIPv6(ip("00000000000000000000000000000001"), 0)).toBe("::1");
    expect(formatIPv6(ip("00000000000000000000ffff01020304"), 0)).toBe(
      "::ffff:1.2.3.4",
    );
    expect(formatIPv6(ip("20010db8000000000000000000000001"), 0)).toBe(
      "2001:db8::1",
    );
    expect(formatIPv6(ip("00010000000000010000000000000001"), 0)).toBe(
      "1:0:0:1::1",
    );
  });
});

describe("[Native] compareBytes", () => {
  it("matches Buffer.compare(Buffer.from(a), Buffer.from(b)) across ASCII, BMP, surrogates and prefixes", () => {
    const samples = [
      "",
      "a",
      "ab",
      "b",
      "a.b",
      "a_b",
      "€",
      "\uD7FF",
      "\uE000",
      "\uFFFD",
      "\u{10000}",
      "\u{1F600}",
      "\u{1F601}",
      "\uD800",
      "\uD801",
      "\uD800a",
      "\uD800b",
      "abc\uD800",
      "abc\uFFFD",
    ];
    for (const a of samples) {
      for (const b of samples) {
        const expected = Math.sign(
          Buffer.compare(Buffer.from(a), Buffer.from(b)),
        );
        expect(Math.sign(compareBytes(a, b))).toBe(expected);
      }
    }
  });
});

describe("[Native] wire validation", () => {
  const decode = (typeName: string, buf: Buffer, rows: number) => {
    const type = parseColumnType(typeName);
    const r = new BinaryReader(buf);
    const prefix = readPrefix(r, type);
    return readColumn(r, type, rows, prefix, { timezone: "UTC" });
  };

  it("decodes LowCardinality(Nullable(Enum8)) when slot 0 holds a non-member sentinel", () => {
    const w = new BinaryWriter()
      .u64(1) // keys version
      .u64((1 << 9) | 0) // has additional keys, UInt8 indexes
      .u64(3) // 3 dictionary entries: NULL sentinel (0), 'a' (1), 'b' (2)
      .u8(0) // not in Enum8('a' = 1, 'b' = 2)
      .u8(1)
      .u8(2)
      .u64(3) // 3 rows
      .u8(0)
      .u8(1)
      .u8(2);
    expect(
      decode(
        "LowCardinality(Nullable(Enum8('a' = 1, 'b' = 2)))",
        w.toBuffer(),
        3,
      ),
    ).toEqual([null, "a", "b"]);
  });

  it("rejects invalid LowCardinality keyType, out-of-bounds index, and empty/oversized granule", () => {
    // keyType = 4 (> 3)
    const badKeyType = new BinaryWriter()
      .u64(1)
      .u64((1 << 9) | 4)
      .u64(1)
      .string("a")
      .u64(1)
      .u8(0);
    expect(() =>
      decode("LowCardinality(String)", badKeyType.toBuffer(), 1),
    ).toThrow(ProtocolError);

    // index 5 out of bounds for 1-entry dictionary
    const oob = new BinaryWriter()
      .u64(1)
      .u64((1 << 9) | 0)
      .u64(1)
      .string("a")
      .u64(1)
      .u8(5);
    expect(() => decode("LowCardinality(String)", oob.toBuffer(), 1)).toThrow(
      ProtocolError,
    );

    // count === 0 with rows = 1
    const zeroCount = new BinaryWriter()
      .u64(1)
      .u64((1 << 9) | 0)
      .u64(1)
      .string("a")
      .u64(0);
    expect(() =>
      decode("LowCardinality(String)", zeroCount.toBuffer(), 1),
    ).toThrow(ProtocolError);

    // count === 2 with rows = 1
    const tooMany = new BinaryWriter()
      .u64(1)
      .u64((1 << 9) | 0)
      .u64(1)
      .string("a")
      .u64(2)
      .u8(0)
      .u8(0);
    expect(() =>
      decode("LowCardinality(String)", tooMany.toBuffer(), 1),
    ).toThrow(ProtocolError);
  });

  it("rejects non-monotonic offsets in Array columns", () => {
    const w = new BinaryWriter()
      .u64(2) // row 0 ends at 2
      .u64(1); // row 1 decreases to 1
    expect(() => decode("Array(UInt8)", w.toBuffer(), 2)).toThrow(
      ProtocolError,
    );
  });

  it("rejects invalid compact Variant discriminators", () => {
    // granule === 0
    const zeroGranule = new BinaryWriter()
      .u64(1) // COMPACT discriminators
      .varuint(0)
      .u8(0);
    expect(() =>
      decode("Variant(UInt8, String)", zeroGranule.toBuffer(), 2),
    ).toThrow(ProtocolError);

    // granule > remaining rows
    const oversized = new BinaryWriter()
      .u64(1)
      .varuint(3)
      .u8(0)
      .u8(0)
      .u8(0)
      .u8(0);
    expect(() =>
      decode("Variant(UInt8, String)", oversized.toBuffer(), 2),
    ).toThrow(ProtocolError);

    // unknown format byte 2
    const badFormat = new BinaryWriter().u64(1).varuint(1).u8(2);
    expect(() =>
      decode("Variant(UInt8, String)", badFormat.toBuffer(), 1),
    ).toThrow(ProtocolError);
  });

  it("rejects out-of-range type index in flattened Dynamic columns", () => {
    const w = new BinaryWriter()
      .u64(3) // DYNAMIC_FLATTENED
      .varuint(1) // 1 type: UInt8 (valid indexes: 0 = UInt8, 1 = NULL)
      .string("UInt8")
      .u8(2); // invalid index > count
    expect(() => decode("Dynamic", w.toBuffer(), 1)).toThrow(ProtocolError);
  });

  it("treats Object.prototype property names as Unsupported types in parseColumnType", () => {
    for (const name of ["toString", "constructor", "valueOf", "__proto__"]) {
      expect(parseColumnType(name)).toEqual({ kind: "Unsupported", name });
    }
  });

  it("decodes 64-bit VarUInt values above Number.MAX_SAFE_INTEGER in varuint64 and Progress/ProfileInfo", () => {
    const encodeVarUInt64 = (v: bigint): Buffer => {
      const bytes: number[] = [];
      let n = v;
      while (n >= 0x80n) {
        bytes.push(Number(n & 0x7fn) | 0x80);
        n >>= 7n;
      }
      bytes.push(Number(n));
      return Buffer.from(bytes);
    };

    const big = (1n << 60n) + 12345n;
    const maxU64 = (1n << 64n) - 1n;
    expect(new BinaryReader(encodeVarUInt64(big)).varuint64()).toBe(big);
    expect(new BinaryReader(encodeVarUInt64(maxU64)).varuint64()).toBe(maxU64);

    // 10th byte > 1 overflows UInt64
    const overflow = Buffer.from([
      0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x02,
    ]);
    expect(() => new BinaryReader(overflow).varuint64()).toThrow(ProtocolError);

    // Progress packet with 64-bit read_bytes > Number.MAX_SAFE_INTEGER
    const progressBuf = Buffer.concat([
      new BinaryWriter().varuint(ServerPacketType.Progress).toBuffer(),
      encodeVarUInt64(100n), // read_rows
      encodeVarUInt64(big), // read_bytes
      encodeVarUInt64(200n), // total_rows_to_read
      encodeVarUInt64(0n), // written_rows
      encodeVarUInt64(0n), // written_bytes
      encodeVarUInt64(5_000_000n), // elapsed_ns
    ]);
    const progress = readServerPacket(
      new BinaryReader(progressBuf),
      REVISION.SERVER_QUERY_TIME_IN_PROGRESS,
      { timezone: "UTC" },
    );
    expect(progress).toEqual({
      type: "progress",
      progress: {
        read_rows: 100n,
        read_bytes: big,
        total_rows_to_read: 200n,
        total_bytes_to_read: 0n,
        written_rows: 0n,
        written_bytes: 0n,
        elapsed_ns: 5_000_000n,
      },
    });
  });

  it("fails fast with ProtocolError on oversized string, bytes and PartUUIDs lengths", () => {
    const hugeLen = new BinaryWriter().varuint(MAX_BYTES_LENGTH + 1).toBuffer();
    expect(() => new BinaryReader(hugeLen).string()).toThrow(ProtocolError);
    expect(() => new BinaryReader(hugeLen).bytes()).toThrow(ProtocolError);

    const hugePartUUIDs = new BinaryWriter()
      .varuint(ServerPacketType.PartUUIDs)
      .varuint(Math.floor(MAX_BYTES_LENGTH / 16) + 1)
      .toBuffer();
    expect(() =>
      readServerPacket(
        new BinaryReader(hugePartUUIDs),
        REVISION.SERVER_QUERY_TIME_IN_PROGRESS,
        { timezone: "UTC" },
      ),
    ).toThrow(ProtocolError);
  });
});
