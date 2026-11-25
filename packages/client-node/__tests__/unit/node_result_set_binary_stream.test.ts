import { describe, it, expect } from "vitest";
import Stream, { Readable } from "stream";
import { ClickHouseError, ResultSet } from "../../src";
import { guid } from "../../../client-common/__tests__/utils/guid";

describe("[Node.js] ResultSet.binaryStream() and rawStream()", () => {
  const tag = "abcdefghijklmnop";
  const message =
    "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.11.1.312)";
  const block = Buffer.from(
    `\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`,
  );
  // Binary data with `\r\n` pairs and a `\n` in each row, as in Parquet.
  const data = Buffer.from(
    Array.from({ length: 4096 }, (_, i) => [i % 256, 0x0d, 0x0a, 0x0a]).flat(),
  );

  function makeResultSet(
    stream: Stream.Readable,
    headers: Record<string, string> = { "x-clickhouse-exception-tag": tag },
  ) {
    return ResultSet.instance({
      stream,
      format: "Parquet",
      query_id: guid(),
      log_error: () => undefined,
      response_headers: headers,
    });
  }

  /** Reads all chunks. With `slow`, waits after each chunk. */
  async function read(stream: AsyncIterable<Buffer>, slow = false) {
    const chunks: Buffer[] = [];
    let error: unknown;
    try {
      for await (const chunk of stream) {
        expect(Buffer.isBuffer(chunk)).toBe(true);
        chunks.push(chunk);
        if (slow) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
      }
    } catch (err) {
      error = err;
    }
    return { bytes: Buffer.concat(chunks), error };
  }

  /** A source that gives `chunks`, then fails as when the server closes the
   *  connection after the exception block. */
  function failingSource(chunks: Buffer[]) {
    const source = new Stream.PassThrough();
    for (const chunk of chunks) {
      source.write(chunk);
    }
    setTimeout(() => {
      const err = new Error("aborted") as NodeJS.ErrnoException;
      err.code = "ECONNRESET";
      source.destroy(err);
    }, 5);
    return source;
  }

  function expectServerError(error: unknown) {
    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("395");
    expect((error as ClickHouseError).type).toBe(
      "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
    );
  }

  it("gives the bytes unchanged, without a split into rows", async () => {
    const rs = makeResultSet(
      Readable.from([data.subarray(0, 1001), data.subarray(1001)]),
    );
    const { bytes, error } = await read(rs.binaryStream());
    expect(error).toBeUndefined();
    expect(bytes.equals(data)).toBe(true);
  });

  it("gives the bytes unchanged without an exception tag header", async () => {
    const body = Buffer.concat([data, block]);
    const rs = makeResultSet(Readable.from([body]), {});
    const { bytes, error } = await read(rs.binaryStream());
    expect(error).toBeUndefined();
    expect(bytes.equals(body)).toBe(true);
  });

  it("gives the bytes before the error, then the server error", async () => {
    const body = Buffer.concat([data, block]);
    for (const slow of [false, true]) {
      for (const chunks of [
        [body],
        [data, block],
        [body.subarray(0, data.length + 7), body.subarray(data.length + 7)],
        Array.from({ length: Math.ceil(body.length / 100) }, (_, i) =>
          body.subarray(i * 100, (i + 1) * 100),
        ),
      ]) {
        const rs = makeResultSet(Readable.from(chunks));
        const { bytes, error } = await read(rs.binaryStream(), slow);
        expectServerError(error);
        expect(bytes.equals(data), `${chunks.length} chunks`).toBe(true);
      }
    }
  });

  it("gives the bytes of a short response before the error", async () => {
    const prefix = Buffer.from([1, 2, 3, 4]);
    const rs = makeResultSet(Readable.from([Buffer.concat([prefix, block])]));
    const { bytes, error } = await read(rs.binaryStream(), true);
    expectServerError(error);
    expect(bytes.equals(prefix)).toBe(true);
  });

  it("gives the server error when the connection closes after the block", async () => {
    // A real server closes the connection after the block, so the source
    // fails and does not end.
    for (const slow of [false, true]) {
      const rs = makeResultSet(failingSource([data, block]));
      const { bytes, error } = await read(rs.binaryStream(), slow);
      expectServerError(error);
      expect(bytes.equals(data)).toBe(true);
    }
  });

  it("gives an incomplete block error when the connection closes in the block", async () => {
    const rs = makeResultSet(failingSource([data, block.subarray(0, 60)]));
    const { bytes, error } = await read(rs.binaryStream());
    expect((error as Error).message).toContain("exception block is incomplete");
    expect(bytes.equals(data)).toBe(true);
  });

  it("gives the source error when there is no block", async () => {
    const rs = makeResultSet(failingSource([data]));
    const { bytes, error } = await read(rs.binaryStream());
    expect((error as NodeJS.ErrnoException).code).toBe("ECONNRESET");
    expect(bytes.equals(data)).toBe(true);
  });

  it("gives the held bytes before a source error with no block", async () => {
    // A `\r`, or a start of a block opening, at the end of the bytes that
    // came: without the tag, they are data.
    for (const tail of [
      "\r",
      "\r\n",
      "\r\n__exc",
      `\r\n__exception__\r\n${tag.slice(0, 5)}`,
    ]) {
      const body = Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(tail)]);
      const rs = makeResultSet(failingSource([body]));
      const { bytes, error } = await read(rs.binaryStream());
      expect((error as NodeJS.ErrnoException).code).toBe("ECONNRESET");
      expect(bytes.equals(body), JSON.stringify(tail)).toBe(true);
    }
  });

  it("gives all bytes and the server error when the block is still in the source buffer", async () => {
    // With a slow consumer, the end of the response, with the block, is still
    // in the buffer of the source when the connection closes.
    const big = Buffer.alloc(3 * 1024 * 1024, 0x61);
    const body = Buffer.concat([big, block]);
    const source = new Readable({ read() {} });
    for (let i = 0; i < body.length; i += 16 * 1024) {
      source.push(body.subarray(i, i + 16 * 1024));
    }
    const rs = makeResultSet(source);
    const stream = rs.binaryStream();
    const err = new Error("aborted") as NodeJS.ErrnoException;
    err.code = "ECONNRESET";
    setTimeout(() => source.destroy(err), 5);
    await new Promise((resolve) => setTimeout(resolve, 30));
    const { bytes, error } = await read(stream);
    expectServerError(error);
    expect(bytes.length).toBe(big.length);
    expect(bytes.equals(big)).toBe(true);
  });

  it("closes the source when the consumer stops early", async () => {
    const source = Readable.from([data, data, data]);
    const rs = makeResultSet(source);
    for await (const _ of rs.binaryStream()) {
      break;
    }
    expect(source.destroyed).toBe(true);
  });

  it("stops the stream on close()", async () => {
    const rs = makeResultSet(new Stream.PassThrough());
    const stream = rs.binaryStream();
    rs.close();
    const { error } = await read(stream);
    expect((error as Error).message).toBe("ResultSet has been closed");
  });

  it("can be called only once, and not after the other methods", async () => {
    const rs = makeResultSet(Readable.from([data]));
    rs.binaryStream();
    expect(() => rs.binaryStream()).toThrow("Stream has been already consumed");
    expect(() => rs.rawStream()).toThrow("Stream has been already consumed");
    const rs2 = makeResultSet(Readable.from([data]));
    await rs2.text();
    expect(() => rs2.binaryStream()).toThrow(
      "Stream has been already consumed",
    );
  });

  it("rawStream() gives the response stream as it is", async () => {
    const source = Readable.from([Buffer.concat([data, block])]);
    const rs = makeResultSet(source);
    const raw = rs.rawStream();
    expect(raw).toBe(source);
    const { bytes, error } = await read(raw);
    expect(error).toBeUndefined();
    expect(bytes.equals(Buffer.concat([data, block]))).toBe(true);
    expect(() => rs.binaryStream()).toThrow("Stream has been already consumed");
  });
});
