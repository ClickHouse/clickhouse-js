import { afterEach, describe, expect, it } from "vitest";
import {
  cityHash128,
  cityHashUsesWasm,
  setCityHashWasmEnabled,
} from "../../src/compression/cityhash";
import { cityHash128JS as referenceCityHash128 } from "../../src/compression/cityhash_js";
import {
  MAX_FRAME_DATA_SIZE,
  compressFrame,
  compressFrames,
  isZstdAvailable,
  readCompressedFrame,
} from "../../src/compression/frames";
import {
  lz4Compress,
  lz4CompressBound,
  lz4CompressInto,
  lz4Decompress,
} from "../../src/compression/lz4";
import {
  BinaryReader,
  BinaryWriter,
  NeedMoreData,
  ProtocolError,
} from "../../src/protocol/binary";

const CHECKSUM_SIZE = 16;
const HEADER_SIZE = 9;
const METHOD_NONE = 0x02;
const METHOD_LZ4 = 0x82;
const METHOD_ZSTD = 0x90;

/**
 * Compressed blocks that a ClickHouse server (26.11) sent for these queries,
 * with `network_compression_method` LZ4 and ZSTD. The first 16 bytes of a
 * block are the CityHash128 that the server computed for the other bytes,
 * so each block is a known answer for the hash and for the decompression.
 * The hashed parts have 31 to 112 bytes: all the branches of the hash for
 * 17 bytes and more.
 */
const SERVER_FRAMES: Array<{ query: string; frames: string[] }> = [
  {
    query: "SELECT 1 AS x",
    frames: [
      "89ff38068ba7a64b063cf98176844de6821f00000014000000f005010002ffffffff00010101780555496e74380001",
      "97a83c67959cb3319820633726e6513f90260000001400000028b52ffd2014a10000010002ffffffff00010101780555496e74380001",
    ],
  },
  {
    query: "SELECT repeat('abc', 30) AS s",
    frames: [
      "ce9a901fb7ee58345782207b624ccf78822c0000006f000000ff09010002ffffffff000101017306537472696e67005a61626303003f506263616263",
      "1b7eb0580f4526327a6f0e7c1b258f3290310000006f00000028b52ffd206ffd0000c0010002ffffffff000101017306537472696e67005a616263010090931b03",
    ],
  },
  {
    query:
      "SELECT 'The quick brown fox jumps over the lazy dog, 0123456789 times.' AS s, 42 AS n",
    frames: [
      "7f7a260cc7984ea99eb596f8d3c3b7ce82680000005d000000f04e010002ffffffff000201017306537472696e67003e54686520717569636b2062726f776e20666f78206a756d7073206f76657220746865206c617a7920646f672c20303132333435363738392074696d65732e016e0555496e7438002a",
      "ecdc9b728d3b594e4d4463f8cbdc2f49906f0000005d00000028b52ffd205de90200010002ffffffff000201017306537472696e67003e54686520717569636b2062726f776e20666f78206a756d7073206f76657220746865206c617a7920646f672c20303132333435363738392074696d65732e016e0555496e7438002a",
    ],
  },
  {
    query:
      "SELECT repeat('hello world ', 1000) AS s, toFixedString('zz', 2) AS f",
    frames: [
      "f164bd6e11593c5b84893a5c340d5de782700000000a2f0000ff13010002ffffffff000201017306537472696e6700e05d68656c6c6f20776f726c64200c00ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffef8201660e4669786564f12e60283229007a7a",
      "b51d397b9c593ecde5b14edb355afc6390500000000a2f000028b52ffd600a2eed01000403010002ffffffff000201017306537472696e6700e05d68656c6c6f20776f726c642001660e4669786564283229007a7a0200f4ae0e5cd1ee7c7902",
    ],
  },
];

/** The Native blocks of the queries of {@link SERVER_FRAMES}: the data that
 *  the compressed blocks contain. */
const BLOCK_INFO = Buffer.from([1, 0, 2, 0xff, 0xff, 0xff, 0xff, 0]);
function nativeBlock(
  rows: number,
  columns: Array<[name: string, type: string, data: Buffer]>,
): Buffer {
  const w = new BinaryWriter().raw(BLOCK_INFO).varuint(columns.length);
  w.varuint(rows);
  for (const [name, type, data] of columns) {
    w.string(name).string(type).u8(0).raw(data);
  }
  return w.toBuffer();
}
const str = (s: string) => new BinaryWriter().string(s).toBuffer();
const SERVER_BLOCKS: Buffer[] = [
  nativeBlock(1, [["x", "UInt8", Buffer.from([1])]]),
  nativeBlock(1, [["s", "String", str("abc".repeat(30))]]),
  nativeBlock(1, [
    [
      "s",
      "String",
      str("The quick brown fox jumps over the lazy dog, 0123456789 times."),
    ],
    ["n", "UInt8", Buffer.from([42])],
  ]),
  nativeBlock(1, [
    ["s", "String", str("hello world ".repeat(1000))],
    ["f", "FixedString(2)", Buffer.from("zz")],
  ]),
];

/**
 * Blocks without compression (method 0x02) with 1 to 7 bytes of data: the
 * hashed parts have 10 to 16 bytes. This client made them, and the server
 * accepted them as the data of an INSERT (the server checks the checksum).
 * A block always has its 9-byte header, so the protocol does not use the
 * hash of fewer bytes.
 */
const ACCEPTED_SHORT_FRAMES = [
  "7074d2629a96de443b9ae47a44b9462e020a0000000100000001",
  "63cc68e7ec10483f2a96a0e705333e77020b000000020000000002",
  "87cbe0506e6bdc968d2285383e1dedfd020c00000003000000ffffff",
  "1075b79508d77e5ebf9ac6fd78015923020d00000004000000ff000101",
  "6b1b288c9c6aee823f2268e31feaed10020e000000050000000178055549",
  "032ca878b3a5a3b472fc87337023925a020e000000050000006e7438004d",
  "bbc357baadcfa777fc92e794df050d63020f00000006000000010002ffffff",
  "f4f95eae61269151e28e122cf8c53627021000000007000000ff000101017805",
  "0ac927b5b39f3ddaa0f235489bae45d902100000000700000055496e7438004d",
];

/**
 * The checksums of the blocks that the server sent, with
 * `network_compression_method = 'NONE'`, for
 * `SELECT toUInt32(number * 2654435761 % 4294967296) AS x FROM numbers(N)`
 * in one Native block. The test makes the same bytes.
 */
const SERVER_LARGE_FRAMES: Array<{
  rows: number;
  /** The data size and the checksum of each compressed block. */
  frames: Array<[size: number, checksum: string]>;
}> = [
  { rows: 2000, frames: [[8021, "4cb5ac7e37da1bc205fe9b771aa98171"]] },
  {
    rows: 262144,
    frames: [
      [1048576, "a656f536bcf942a57944bb739d622c69"],
      [22, "89b4057933e9909e9654541bc3cce4f5"],
    ],
  },
];

function multiplicativeColumn(rows: number): Buffer {
  const data = Buffer.allocUnsafe(rows * 4);
  for (let i = 0; i < rows; i++) {
    data.writeUInt32LE(Math.imul(i, 2654435761) >>> 0, i * 4);
  }
  return data;
}

/** A compressed block with the given header values and no valid checksum
 *  check: the checksum is the hash of this client. */
function rawFrame(
  method: number,
  payload: Buffer,
  decompressedSize: number,
  compressedSize = HEADER_SIZE + payload.length,
): Buffer {
  const frame = Buffer.alloc(CHECKSUM_SIZE + HEADER_SIZE + payload.length);
  frame[CHECKSUM_SIZE] = method;
  frame.writeUInt32LE(compressedSize, CHECKSUM_SIZE + 1);
  frame.writeUInt32LE(decompressedSize, CHECKSUM_SIZE + 5);
  payload.copy(frame, CHECKSUM_SIZE + HEADER_SIZE);
  cityHash128(frame.subarray(CHECKSUM_SIZE)).copy(frame, 0);
  return frame;
}

function readAllFrames(frames: Buffer[]): Buffer {
  const r = new BinaryReader(Buffer.concat(frames));
  const parts: Buffer[] = [];
  while (r.pos < r.buf.length) parts.push(readCompressedFrame(r));
  return Buffer.concat(parts);
}

const hashes: Array<[string, (data: Uint8Array) => Buffer]> = [
  ["WebAssembly", cityHash128],
  ["JavaScript", referenceCityHash128],
];

function pseudoRandom(n: number, seed: number): Buffer {
  const out = Buffer.allocUnsafe(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = x >>> 24;
  }
  return out;
}

describe("[Native] LZ4", () => {
  const inputs: Array<[string, Buffer]> = [
    ["empty", Buffer.alloc(0)],
    ["short", Buffer.from("abc")],
    ["13 bytes", Buffer.from("abcdabcdabcda")],
    ["repetitive", Buffer.from("hello world ".repeat(10_000))],
    ["zeros", Buffer.alloc(100_000)],
    ["random", pseudoRandom(70_000, 1)],
    [
      "mixed",
      Buffer.concat([
        pseudoRandom(1000, 2),
        Buffer.alloc(5000, 7),
        pseudoRandom(300, 3),
      ]),
    ],
  ];
  for (const [name, input] of inputs) {
    it(`round-trips ${name} data`, () => {
      const compressed = lz4Compress(input);
      expect(lz4Decompress(compressed, input.length).equals(input)).toBe(true);
    });
  }

  it("round-trips many mixed inputs", () => {
    let seed = 1;
    for (let iteration = 0; iteration < 300; iteration++) {
      const parts: Buffer[] = [];
      const count = 1 + (iteration % 7);
      for (let p = 0; p < count; p++) {
        seed++;
        const size = (seed * 7919) % 3000;
        if (seed % 3 === 0) parts.push(pseudoRandom(size, seed));
        else if (seed % 3 === 1) parts.push(Buffer.alloc(size, seed & 0xff));
        else
          parts.push(
            Buffer.from("abcdefgh".repeat(1 + size / 8).slice(0, size)),
          );
      }
      const input = Buffer.concat(parts);
      const compressed = lz4Compress(input);
      expect(lz4Decompress(compressed, input.length).equals(input)).toBe(true);
    }
  });

  it("compresses repetitive data", () => {
    const input = Buffer.from("hello world ".repeat(10_000));
    expect(lz4Compress(input).length).toBeLessThan(input.length / 20);
  });

  it("rejects corrupted data", () => {
    const compressed = lz4Compress(Buffer.from("hello world ".repeat(100)));
    expect(() => lz4Decompress(compressed, 10)).toThrow("Corrupted LZ4 data");
  });

  it("decompresses the LZ4 blocks of the server", () => {
    SERVER_FRAMES.forEach(({ query, frames }, i) => {
      const frame = Buffer.from(frames[0]!, "hex");
      expect(frame[CHECKSUM_SIZE], query).toBe(METHOD_LZ4);
      const size = frame.readUInt32LE(CHECKSUM_SIZE + 5);
      const data = lz4Decompress(
        frame.subarray(CHECKSUM_SIZE + HEADER_SIZE),
        size,
      );
      expect(data.toString("hex"), query).toBe(
        SERVER_BLOCKS[i]!.toString("hex"),
      );
    });
  });

  it("writes into a buffer at an offset", () => {
    const input = Buffer.from("hello world ".repeat(50));
    const dst = Buffer.alloc(7 + lz4CompressBound(input.length), 0xee);
    const end = lz4CompressInto(input, dst, 7);
    expect(dst.subarray(0, 7).equals(Buffer.alloc(7, 0xee))).toBe(true);
    expect(dst.subarray(7, end).equals(lz4Compress(input))).toBe(true);
    expect(
      lz4Decompress(dst.subarray(7, end), input.length).equals(input),
    ).toBe(true);
  });

  it("gives the same result after an input of another size", () => {
    // The hash table is shared: a call must not see entries of the call before.
    const small = Buffer.from("abcdabcdabcdabcdabcdabcdabcdabcd");
    const first = Buffer.from(lz4Compress(small));
    lz4Compress(pseudoRandom(300_000, 9));
    lz4Compress(Buffer.from("abcd".repeat(50_000)));
    expect(lz4Compress(small).equals(first)).toBe(true);
    for (const n of [13, 100, 255, 256, 257, 1000, 65_535, 65_536, 65_537]) {
      const input = Buffer.from("0123456789abcdef".repeat(1 + n / 16)).subarray(
        0,
        n,
      );
      const compressed = lz4Compress(input);
      expect(lz4Decompress(compressed, n).equals(input), `size ${n}`).toBe(
        true,
      );
      if (n >= 100) expect(compressed.length).toBeLessThan(n / 2);
    }
  });

  describe("malformed data", () => {
    const cases: Array<[string, number[], number]> = [
      // token 0x10: one literal and a match
      ["a match offset of 0", [0x10, 0x41, 0x00, 0x00], 5],
      ["a match offset before the start", [0x10, 0x41, 0x02, 0x00], 5],
      ["a match offset with one byte", [0x10, 0x41, 0x01], 5],
      ["no match offset after a token", [0x10, 0x41], 5],
      // token 0x1f: the match length continues in the next bytes
      ["a match length that does not end", [0x1f, 0x41, 0x01, 0x00, 0xff], 275],
      ["no match length byte", [0x1f, 0x41, 0x01, 0x00], 20],
      // token 0xf0: the literal length continues in the next bytes
      ["a literal length that does not end", [0xf0, 0xff, 0xff], 525],
      ["no literal length byte", [0xf0], 15],
      ["literals past the end of the data", [0x50, 0x41, 0x42], 5],
      ["literals past the end of the output", [0x30, 0x41, 0x42, 0x43], 2],
      [
        "a match past the end of the output",
        [0x1f, 0x41, 0x01, 0x00, 0x05],
        10,
      ],
      ["less data than the size", [0x10, 0x41], 2],
      ["more data than the size", [0x20, 0x41, 0x42], 1],
      ["a size that the data cannot give", [0x10, 0x41], 1000],
      ["no data for a size", [], 1],
    ];
    for (const [name, bytes, size] of cases) {
      it(`rejects ${name}`, () => {
        expect(() => lz4Decompress(Buffer.from(bytes), size)).toThrow(
          "Corrupted LZ4 data",
        );
      });
    }

    it("accepts a valid match after the checks", () => {
      // One literal "A", then a match of 4 + 15 + 3 bytes at offset 1,
      // then the last literal "B".
      const data = Buffer.from([0x1f, 0x41, 0x01, 0x00, 0x03, 0x10, 0x42]);
      expect(lz4Decompress(data, 24).toString()).toBe("A".repeat(23) + "B");
    });

    it("gives an error or the exact size for random data", () => {
      for (let seed = 1; seed <= 3000; seed++) {
        const data = pseudoRandom(1 + (seed % 40), seed);
        const size = (seed * 31) % 300;
        try {
          expect(lz4Decompress(data, size).length).toBe(size);
        } catch (err) {
          expect((err as Error).message).toContain("Corrupted LZ4 data");
        }
      }
    });
  });
});

describe("[Native] CityHash128 v1.0.2", () => {
  it("runs in WebAssembly", () => {
    // A bug in the module bytes would make the client fall back to JavaScript.
    expect(cityHashUsesWasm()).toBe(true);
  });

  it("gives the same hashes as the JavaScript implementation", () => {
    const lengths = [
      ...Array.from({ length: 601 }, (_, i) => i),
      1023,
      1024,
      4095,
      65536,
      100_003,
      1_000_000,
    ];
    for (const n of lengths) {
      const data = pseudoRandom(n, n * 31 + 7);
      expect(cityHash128(data).toString("hex"), `length ${n}`).toBe(
        referenceCityHash128(data).toString("hex"),
      );
    }
    // Bytes with the high bit set, and all-ones words.
    for (const n of [9, 17, 64, 129, 300]) {
      const data = Buffer.alloc(n, 0xff);
      expect(cityHash128(data).equals(referenceCityHash128(data))).toBe(true);
    }
  });

  for (const [name, hash] of hashes) {
    describe(`${name}: known answers from the server`, () => {
      it("hashes the compressed blocks that the server sent", () => {
        for (const { query, frames } of SERVER_FRAMES) {
          for (const hex of frames) {
            const frame = Buffer.from(hex, "hex");
            expect(
              hash(frame.subarray(CHECKSUM_SIZE)).toString("hex"),
              `${query}, ${frame.length - CHECKSUM_SIZE} bytes`,
            ).toBe(frame.subarray(0, CHECKSUM_SIZE).toString("hex"));
          }
        }
      });

      it("hashes 10 to 16 bytes as the server does", () => {
        for (const hex of ACCEPTED_SHORT_FRAMES) {
          const frame = Buffer.from(hex, "hex");
          expect(
            hash(frame.subarray(CHECKSUM_SIZE)).toString("hex"),
            `${frame.length - CHECKSUM_SIZE} bytes`,
          ).toBe(frame.subarray(0, CHECKSUM_SIZE).toString("hex"));
        }
      });

      it("hashes blocks of 8 KiB and 1 MiB as the server does", () => {
        for (const { rows, frames } of SERVER_LARGE_FRAMES) {
          const block = nativeBlock(rows, [
            ["x", "UInt32", multiplicativeColumn(rows)],
          ]);
          let pos = 0;
          for (const [size, checksum] of frames) {
            const hashed = Buffer.allocUnsafe(HEADER_SIZE + size);
            hashed[0] = METHOD_NONE;
            hashed.writeUInt32LE(HEADER_SIZE + size, 1);
            hashed.writeUInt32LE(size, 5);
            block.copy(hashed, HEADER_SIZE, pos, pos + size);
            pos += size;
            expect(hash(hashed).toString("hex"), `${rows} rows`).toBe(checksum);
          }
          expect(pos).toBe(block.length);
        }
      });
    });
  }

  it("hashes a small input correctly after a large input", () => {
    // A large input uses another WebAssembly instance, with its own memory.
    const small = pseudoRandom(100, 4);
    const expected = referenceCityHash128(small).toString("hex");
    for (const n of [4 * 1024 * 1024 - 16, 4 * 1024 * 1024 - 15, 9_000_000]) {
      const large = pseudoRandom(n, n);
      expect(cityHash128(large).toString("hex"), `length ${n}`).toBe(
        referenceCityHash128(large).toString("hex"),
      );
      expect(cityHash128(small).toString("hex")).toBe(expected);
    }
    expect(cityHashUsesWasm()).toBe(true);
  });

  it("gives a 16-byte hash that depends on every byte", () => {
    for (const n of [0, 1, 7, 8, 15, 16, 17, 64, 127, 128, 129, 1000]) {
      const data = pseudoRandom(n, n + 10);
      const hash = cityHash128(data);
      expect(hash.length).toBe(16);
      if (n > 0) {
        const changed = Buffer.from(data);
        changed[n - 1] = changed[n - 1]! ^ 1;
        expect(cityHash128(changed).equals(hash)).toBe(false);
      }
    }
  });
});

describe("[Native] compressed blocks", () => {
  const methods = isZstdAvailable()
    ? (["lz4", "zstd"] as const)
    : (["lz4"] as const);
  for (const method of methods) {
    it(`round-trips ${method} blocks`, () => {
      const data = Buffer.concat([
        pseudoRandom(5000, 5),
        Buffer.alloc(20_000, 1),
      ]);
      const frame = compressFrame(data, method);
      const r = new BinaryReader(frame);
      expect(readCompressedFrame(r).equals(data)).toBe(true);
      expect(r.pos).toBe(frame.length);
    });

    it(`cuts ${method} data into blocks of 1 MiB`, () => {
      const MiB = MAX_FRAME_DATA_SIZE;
      expect(MiB).toBe(1024 * 1024);
      const source = Buffer.concat([
        pseudoRandom(MiB, 11),
        Buffer.from("hello world ".repeat(250_000)),
      ]);
      for (const size of [0, 1, MiB - 1, MiB, MiB + 1, 3.5 * MiB]) {
        const data = source.subarray(0, size);
        const frames = compressFrames(data, method);
        expect(frames.length, `size ${size}`).toBe(
          Math.max(1, Math.ceil(size / MiB)),
        );
        for (const frame of frames) {
          expect(
            frame.readUInt32LE(CHECKSUM_SIZE + 5),
            `size ${size}`,
          ).toBeLessThanOrEqual(MiB);
          expect(frame.readUInt32LE(CHECKSUM_SIZE + 1)).toBe(
            frame.length - CHECKSUM_SIZE,
          );
        }
        expect(readAllFrames(frames).equals(data), `size ${size}`).toBe(true);
      }
    });
  }

  it("reads the compressed blocks of the server", () => {
    SERVER_FRAMES.forEach(({ query, frames }, i) => {
      for (const hex of frames) {
        const frame = Buffer.from(hex, "hex");
        if (frame[CHECKSUM_SIZE] === METHOD_ZSTD && !isZstdAvailable())
          continue;
        const r = new BinaryReader(frame);
        expect(readCompressedFrame(r).toString("hex"), query).toBe(
          SERVER_BLOCKS[i]!.toString("hex"),
        );
        expect(r.pos).toBe(frame.length);
      }
    });
  });

  it("reads a block without compression", () => {
    for (const hex of ACCEPTED_SHORT_FRAMES) {
      const frame = Buffer.from(hex, "hex");
      const data = readCompressedFrame(new BinaryReader(frame));
      expect(data.equals(frame.subarray(CHECKSUM_SIZE + HEADER_SIZE))).toBe(
        true,
      );
    }
  });

  it("does not keep a large buffer for data that compresses well", () => {
    const data = Buffer.alloc(100_000, 1);
    const frame = compressFrame(data, "lz4");
    expect(frame.length).toBeLessThan(1000);
    expect(frame.buffer.byteLength).toBeLessThan(data.length);
    expect(readCompressedFrame(new BinaryReader(frame)).equals(data)).toBe(
      true,
    );
  });

  it("needs the full block", () => {
    const frame = compressFrame(Buffer.from("x".repeat(1000)), "lz4");
    for (const length of [0, 1, 20, 24, 25, frame.length - 1]) {
      const r = new BinaryReader(frame.subarray(0, length));
      expect(() => readCompressedFrame(r), `length ${length}`).toThrow(
        NeedMoreData,
      );
      // The reader stays at the start of the block for the next try.
      expect(r.pos).toBe(0);
    }
  });

  it("detects a wrong checksum", () => {
    const frame = compressFrame(Buffer.from("x".repeat(1000)), "lz4");
    frame[frame.length - 1] = frame[frame.length - 1]! ^ 0xff;
    expect(() => readCompressedFrame(new BinaryReader(frame))).toThrow(
      "Checksum mismatch",
    );
  });

  describe("wrong blocks", () => {
    const read = (frame: Buffer) => () =>
      readCompressedFrame(new BinaryReader(frame));

    it("rejects an unknown method", () => {
      const frame = rawFrame(0x91, Buffer.from("abc"), 3);
      expect(read(frame)).toThrow(ProtocolError);
      expect(read(frame)).toThrow("Unsupported compression method 0x91");
    });

    it("rejects a block without compression that has a wrong size", () => {
      const frame = rawFrame(METHOD_NONE, Buffer.from("abc"), 1000);
      expect(read(frame)).toThrow(ProtocolError);
      expect(read(frame)).toThrow("3 bytes instead of 1000");
    });

    it("rejects a compressed size that is smaller than the header", () => {
      for (const size of [0, 8]) {
        const frame = rawFrame(METHOD_LZ4, Buffer.alloc(20), 20, size);
        expect(read(frame)).toThrow(ProtocolError);
        expect(read(frame)).toThrow(
          `Wrong size of a compressed block: ${size}`,
        );
      }
    });

    it("rejects sizes above the limit before it reads or allocates", () => {
      const GiB = 0x40000000;
      // Only the header is in the buffer: the error does not need the data.
      const tooLong = rawFrame(METHOD_LZ4, Buffer.alloc(0), 10, GiB + 1);
      expect(read(tooLong)).toThrow("Wrong size of a compressed block");
      const tooLarge = rawFrame(METHOD_LZ4, Buffer.alloc(0), GiB + 1, 100);
      expect(read(tooLarge)).toThrow(ProtocolError);
      expect(read(tooLarge)).toThrow(
        "Wrong size of the data of a compressed block: 1073741825",
      );
      const max = rawFrame(METHOD_LZ4, Buffer.alloc(0), 0xffffffff, 100);
      expect(read(max)).toThrow("Wrong size of the data of a compressed block");
    });

    it("rejects an LZ4 block with a size that the data cannot give", () => {
      // A valid checksum and a declared size of 1 GiB: no allocation.
      const frame = rawFrame(METHOD_LZ4, Buffer.from([0x10, 0x41]), 0x40000000);
      expect(read(frame)).toThrow(ProtocolError);
      expect(read(frame)).toThrow("Corrupted LZ4 data");
    });

    it("rejects a truncated LZ4 block", () => {
      const frame = rawFrame(METHOD_LZ4, Buffer.from([0x10, 0x41, 0x01]), 5);
      expect(read(frame)).toThrow(ProtocolError);
      expect(read(frame)).toThrow("Corrupted LZ4 data");
    });

    it.skipIf(!isZstdAvailable())("rejects ZSTD data with a wrong size", () => {
      const data = Buffer.from("hello world ".repeat(1000));
      const good = compressFrame(data, "zstd");
      const payload = good.subarray(CHECKSUM_SIZE + HEADER_SIZE);
      // The data is larger than the size in the header.
      const larger = rawFrame(METHOD_ZSTD, payload, 100);
      expect(read(larger)).toThrow(ProtocolError);
      // The data is smaller than the size in the header.
      const smaller = rawFrame(METHOD_ZSTD, payload, data.length + 1);
      expect(read(smaller)).toThrow(ProtocolError);
      expect(read(smaller)).toThrow("Wrong size of decompressed ZSTD data");
      const garbage = rawFrame(METHOD_ZSTD, Buffer.from("not zstd"), 8);
      expect(read(garbage)).toThrow("Corrupted ZSTD data");
    });
  });

  describe("with the JavaScript hash", () => {
    afterEach(() => {
      setCityHashWasmEnabled(true);
    });

    it("writes and reads blocks", () => {
      const data = Buffer.concat([
        pseudoRandom(70_000, 21),
        Buffer.alloc(2_000_000, 3),
      ]);
      const withWasm = compressFrames(data, "lz4");
      expect(setCityHashWasmEnabled(false)).toBe(true);
      expect(cityHashUsesWasm()).toBe(false);
      const withJS = compressFrames(data, "lz4");
      expect(withJS.length).toBe(withWasm.length);
      withJS.forEach((frame, i) => {
        expect(frame.equals(withWasm[i]!)).toBe(true);
      });
      expect(readAllFrames(withJS).equals(data)).toBe(true);
      // The blocks of the server, with the checksums of the server.
      SERVER_FRAMES.forEach(({ frames }, i) => {
        const frame = Buffer.from(frames[0]!, "hex");
        expect(
          readCompressedFrame(new BinaryReader(frame)).equals(
            SERVER_BLOCKS[i]!,
          ),
        ).toBe(true);
      });
      const bad = Buffer.from(SERVER_FRAMES[0]!.frames[0]!, "hex");
      bad[0] = bad[0]! ^ 1;
      expect(() => readCompressedFrame(new BinaryReader(bad))).toThrow(
        "Checksum mismatch",
      );
    });
  });
});
