import zlib from "node:zlib";
import type { BinaryReader } from "../protocol/binary";
import { ProtocolError } from "../protocol/binary";
import { cityHash128 } from "./cityhash";
import { lz4CompressBound, lz4CompressInto, lz4Decompress } from "./lz4";

/**
 * Compressed blocks of the native protocol:
 *
 *   checksum      16 bytes   CityHash128 v1.0.2 of the rest of the block
 *   method         1 byte    0x02 none, 0x82 LZ4, 0x90 ZSTD
 *   compressed     4 bytes   the size of the block without the checksum
 *   decompressed   4 bytes   the size of the data after decompression
 *   data
 */
export type NativeCompressionMethod = "lz4" | "zstd";

const METHOD_NONE = 0x02;
const METHOD_LZ4 = 0x82;
const METHOD_ZSTD = 0x90;
const CHECKSUM_SIZE = 16;
const HEADER_SIZE = 9;
/** The server rejects larger compressed blocks (DBMS_MAX_COMPRESSED_SIZE).
 *  The client uses the same limit for the two sizes in the header of a
 *  block from the server, before it allocates memory. */
const MAX_COMPRESSED_SIZE = 0x40000000;
/** The client cuts its data into compressed blocks of this size at most, as
 *  the server does (`max_compress_block_size`). */
export const MAX_FRAME_DATA_SIZE = 1 << 20;
/** Reusable synchronous scratch buffer for LZ4 frame compression (at most
 *  one 1 MiB frame plus LZ4 worst-case expansion and frame header). */
let lz4Scratch: Buffer | undefined;

export function isZstdAvailable(): boolean {
  return (
    typeof zlib.zstdCompressSync === "function" &&
    typeof zlib.zstdDecompressSync === "function"
  );
}

/** Makes one compressed block from the data. Use {@link compressFrames} for
 *  data of any size. */
export function compressFrame(
  data: Buffer,
  method: NativeCompressionMethod,
  zstdLevel?: number,
): Buffer {
  const dataStart = CHECKSUM_SIZE + HEADER_SIZE;
  let frame: Buffer;
  let methodByte: number;
  if (method === "zstd") {
    methodByte = METHOD_ZSTD;
    const payload = zlib.zstdCompressSync(
      data,
      zstdLevel === undefined
        ? undefined
        : { params: { [zlib.constants.ZSTD_c_compressionLevel]: zstdLevel } },
    );
    frame = Buffer.allocUnsafe(dataStart + payload.length);
    payload.copy(frame, dataStart);
  } else {
    methodByte = METHOD_LZ4;
    const needed = dataStart + lz4CompressBound(data.length);
    if (data.length <= MAX_FRAME_DATA_SIZE) {
      if (lz4Scratch === undefined || lz4Scratch.length < needed) {
        lz4Scratch = Buffer.allocUnsafe(needed);
      }
      const end = lz4CompressInto(data, lz4Scratch, dataStart);
      frame = Buffer.allocUnsafe(end);
      lz4Scratch.copy(frame, dataStart, dataStart, end);
    } else {
      const buffer = Buffer.allocUnsafe(needed);
      const end = lz4CompressInto(data, buffer, dataStart);
      frame = Buffer.allocUnsafe(end);
      buffer.copy(frame, dataStart, dataStart, end);
    }
  }
  frame[CHECKSUM_SIZE] = methodByte;
  frame.writeUInt32LE(frame.length - CHECKSUM_SIZE, CHECKSUM_SIZE + 1);
  frame.writeUInt32LE(data.length, CHECKSUM_SIZE + 5);
  cityHash128(frame.subarray(CHECKSUM_SIZE)).copy(frame, 0);
  return frame;
}

/**
 * Makes the compressed blocks for the data: one block for each part of
 * {@link MAX_FRAME_DATA_SIZE} bytes at most. The receiver reads the blocks
 * one after the other as one stream. Empty data gives one block.
 */
export function compressFrames(
  data: Buffer,
  method: NativeCompressionMethod,
  zstdLevel?: number,
): Buffer[] {
  if (data.length <= MAX_FRAME_DATA_SIZE) {
    return [compressFrame(data, method, zstdLevel)];
  }
  const frames: Buffer[] = [];
  for (let pos = 0; pos < data.length; pos += MAX_FRAME_DATA_SIZE) {
    frames.push(
      compressFrame(
        data.subarray(pos, Math.min(pos + MAX_FRAME_DATA_SIZE, data.length)),
        method,
        zstdLevel,
      ),
    );
  }
  return frames;
}

/** Reads one compressed block and returns its decompressed data. Throws
 *  `NeedMoreData` (from the reader) if the block is not complete yet. */
export function readCompressedFrame(r: BinaryReader): Buffer {
  r.ensure(CHECKSUM_SIZE + HEADER_SIZE);
  const start = r.pos;
  const method = r.buf[start + CHECKSUM_SIZE]!;
  const compressedSize = r.buf.readUInt32LE(start + CHECKSUM_SIZE + 1);
  const decompressedSize = r.buf.readUInt32LE(start + CHECKSUM_SIZE + 5);
  if (compressedSize < HEADER_SIZE || compressedSize > MAX_COMPRESSED_SIZE) {
    throw new ProtocolError(
      `Wrong size of a compressed block: ${compressedSize}`,
    );
  }
  if (decompressedSize > MAX_COMPRESSED_SIZE) {
    throw new ProtocolError(
      `Wrong size of the data of a compressed block: ${decompressedSize}`,
    );
  }
  r.ensure(CHECKSUM_SIZE + compressedSize);
  const block = r.buf.subarray(
    start + CHECKSUM_SIZE,
    start + CHECKSUM_SIZE + compressedSize,
  );
  const checksum = r.buf.subarray(start, start + CHECKSUM_SIZE);
  if (!cityHash128(block).equals(checksum)) {
    throw new ProtocolError(
      "Checksum mismatch in a compressed block from the server",
    );
  }
  const payload = block.subarray(HEADER_SIZE);
  const data = decompress(method, payload, decompressedSize);
  r.pos = start + CHECKSUM_SIZE + compressedSize;
  return data;
}

function decompress(
  method: number,
  payload: Buffer,
  decompressedSize: number,
): Buffer {
  switch (method) {
    case METHOD_NONE:
      if (payload.length !== decompressedSize) {
        throw new ProtocolError(
          `Wrong size of the data of a block without compression: ${payload.length} bytes instead of ${decompressedSize}`,
        );
      }
      return Buffer.from(payload);
    case METHOD_LZ4:
      try {
        return lz4Decompress(payload, decompressedSize);
      } catch (err) {
        throw new ProtocolError((err as Error).message);
      }
    case METHOD_ZSTD: {
      if (!isZstdAvailable()) {
        throw new ProtocolError(
          "The server sent ZSTD data, but this Node.js version has no zstd support (Node.js 22.15.0 or later has it). " +
            "Use compression: 'lz4', or set network_compression_method = 'LZ4' for the user.",
        );
      }
      let out: Buffer;
      try {
        // The limit stops the decompression of data that is larger than the
        // size in the header.
        out = zlib.zstdDecompressSync(payload, {
          maxOutputLength: Math.max(decompressedSize, 1),
        });
      } catch (err) {
        throw new ProtocolError(
          `Corrupted ZSTD data: ${(err as Error).message}`,
        );
      }
      if (out.length !== decompressedSize) {
        throw new ProtocolError(
          `Wrong size of decompressed ZSTD data: ${out.length} bytes instead of ${decompressedSize}`,
        );
      }
      return out;
    }
    default:
      throw new ProtocolError(
        `Unsupported compression method 0x${method.toString(16)} from the server`,
      );
  }
}
