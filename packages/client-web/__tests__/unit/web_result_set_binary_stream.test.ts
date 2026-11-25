import { describe, it, expect } from "vitest";
import { ClickHouseError, ResultSet } from "../../src";
import { guid } from "../../../client-common/__tests__/utils/guid";

describe("[Web] ResultSet.binaryStream() and rawStream()", () => {
  const tag = "abcdefghijklmnop";
  const message =
    "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.11.1.312)";
  const encoder = new TextEncoder();
  const block = encoder.encode(
    `\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`,
  );
  // Binary data with `\r\n` pairs and a `\n` in each row, as in Parquet.
  const data = Uint8Array.from(
    Array.from({ length: 4096 }, (_, i) => [i % 256, 0x0d, 0x0a, 0x0a]).flat(),
  );

  function join(...parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }

  /** A response stream. With `failAfter`, it fails after the chunks, as when
   *  the server closes the connection after the exception block. */
  function source(chunks: Uint8Array[], failAfter = false) {
    return new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk.slice());
        }
        if (failAfter) {
          setTimeout(() => controller.error(new TypeError("terminated")), 5);
        } else {
          controller.close();
        }
      },
    });
  }

  function makeResultSet(
    stream: ReadableStream,
    headers: Record<string, string> = { "x-clickhouse-exception-tag": tag },
  ) {
    return new ResultSet(stream, "Parquet", guid(), headers);
  }

  /** Reads all chunks. With `transfer`, the reader transfers the buffer of
   *  each chunk after it copied it, as with postMessage to a worker. */
  async function read(stream: ReadableStream<Uint8Array>, transfer = false) {
    const chunks: Uint8Array[] = [];
    let error: unknown;
    const reader = stream.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        expect(value).toBeInstanceOf(Uint8Array);
        chunks.push(value.slice());
        if (transfer) {
          structuredClone(value.buffer, { transfer: [value.buffer] });
        }
      }
    } catch (err) {
      error = err;
    }
    return { bytes: join(...chunks), error };
  }

  function expectServerError(error: unknown) {
    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("395");
    expect((error as ClickHouseError).type).toBe(
      "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
    );
  }

  it("gives the bytes unchanged, without a split into rows", async () => {
    for (const transfer of [false, true]) {
      const rs = makeResultSet(
        source([data.subarray(0, 1001), data.subarray(1001)]),
      );
      const { bytes, error } = await read(rs.binaryStream(), transfer);
      expect(error).toBeUndefined();
      expect(bytes).toEqual(data);
    }
  });

  it("gives the bytes unchanged without an exception tag header", async () => {
    const body = join(data, block);
    const rs = makeResultSet(source([body]), {});
    const { bytes, error } = await read(rs.binaryStream());
    expect(error).toBeUndefined();
    expect(bytes).toEqual(body);
  });

  it("gives the bytes before the error, then the server error", async () => {
    const body = join(data, block);
    for (const transfer of [false, true]) {
      for (const chunks of [
        [body],
        [data, block],
        [body.subarray(0, data.length + 7), body.subarray(data.length + 7)],
        Array.from({ length: Math.ceil(body.length / 100) }, (_, i) =>
          body.subarray(i * 100, (i + 1) * 100),
        ),
      ]) {
        const rs = makeResultSet(source(chunks));
        const { bytes, error } = await read(rs.binaryStream(), transfer);
        expectServerError(error);
        expect(bytes, `${chunks.length} chunks`).toEqual(data);
      }
    }
  });

  it("gives the server error when the connection closes after the block", async () => {
    const rs = makeResultSet(source([data, block], true));
    const { bytes, error } = await read(rs.binaryStream());
    expectServerError(error);
    expect(bytes).toEqual(data);
  });

  it("gives the source error when there is no block", async () => {
    const rs = makeResultSet(source([data], true));
    const { bytes, error } = await read(rs.binaryStream());
    expect(error).toBeInstanceOf(TypeError);
    expect(bytes).toEqual(data);
  });

  it("gives the held bytes before a source error with no block", async () => {
    for (const tail of [
      "\r",
      "\r\n",
      "\r\n__exc",
      `\r\n__exception__\r\n${tag.slice(0, 5)}`,
    ]) {
      const body = join(Uint8Array.of(0, 1, 2), encoder.encode(tail));
      const rs = makeResultSet(source([body], true));
      const { bytes, error } = await read(rs.binaryStream());
      expect(error, JSON.stringify(tail)).toBeInstanceOf(TypeError);
      expect(bytes, JSON.stringify(tail)).toEqual(body);
    }
  });

  describe("span", () => {
    function fakeSpan() {
      return {
        ended: 0,
        errors: [] as Error[],
        attributes: {} as Record<string, unknown>,
        setAttributes(attributes: Record<string, unknown>) {
          Object.assign(this.attributes, attributes);
        },
        setStatus() {
          //
        },
        recordException(error: Error) {
          this.errors.push(error);
        },
        end() {
          this.ended++;
        },
      };
    }
    function withSpan(stream: ReadableStream) {
      const span = fakeSpan();
      const rs = new ResultSet(
        stream,
        "Parquet",
        guid(),
        { "x-clickhouse-exception-tag": tag },
        undefined,
        span,
      );
      return { rs, span };
    }
    const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

    it("ends once at the end of the response, with the byte count", async () => {
      const { rs, span } = withSpan(source([data]));
      await read(rs.binaryStream());
      await tick();
      expect(span.ended).toBe(1);
      expect(span.errors).toEqual([]);
      expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(
        data.length,
      );
    });

    it("ends once with the server error", async () => {
      const { rs, span } = withSpan(source([data, block]));
      await read(rs.binaryStream());
      await tick();
      expect(span.ended).toBe(1);
      expectServerError(span.errors[0]);
    });

    it("ends once with a source error", async () => {
      const { rs, span } = withSpan(source([data], true));
      await read(rs.binaryStream());
      await tick();
      expect(span.ended).toBe(1);
      expect(span.errors[0]).toBeInstanceOf(TypeError);
    });

    it("ends once when the consumer cancels, and cancels the source", async () => {
      let cancelled = 0;
      const { rs, span } = withSpan(
        new ReadableStream({
          cancel() {
            cancelled++;
          },
        }),
      );
      await rs.binaryStream().cancel("stop");
      await tick();
      expect(cancelled).toBe(1);
      expect(span.ended).toBe(1);
    });
  });

  it("can be called only once, and not after the other methods", async () => {
    const rs = makeResultSet(source([data]));
    rs.binaryStream();
    expect(() => rs.binaryStream()).toThrow("Stream has been already consumed");
    expect(() => rs.rawStream()).toThrow("Stream has been already consumed");
  });

  it("rawStream() gives the response stream as it is", async () => {
    const stream = source([join(data, block)]);
    const rs = makeResultSet(stream);
    const raw = rs.rawStream();
    expect(raw).toBe(stream);
    const { bytes, error } = await read(raw);
    expect(error).toBeUndefined();
    expect(bytes).toEqual(join(data, block));
  });
});
