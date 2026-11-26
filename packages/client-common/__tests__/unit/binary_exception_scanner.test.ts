import { describe, it, expect } from "vitest";
import { ClickHouseError } from "../../src/index";
import { BinaryExceptionScanner } from "../../src/utils/stream";

// The scanner gives the bytes of a binary response (for example Parquet)
// unchanged, and finds a mid-stream exception block (ClickHouse 25.11+):
//   \r\n__exception__\r\n<tag>\r\n<message>\n<len> <tag>\r\n__exception__\r\n
describe("BinaryExceptionScanner", () => {
  const tag = "abcdefghijklmnop";
  const message =
    "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: while executing 'FUNCTION throwIf(equals(number, 2) :: 1) -> throwIf(equals(number, 2))'. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.11.1.312)";
  const encoder = new TextEncoder();
  const block = (t = tag, m = message) =>
    encoder.encode(
      `\r\n__exception__\r\n${t}\r\n${m}\n${encoder.encode(m).length + 1} ${t}\r\n__exception__\r\n`,
    );
  // Binary data with `\r\n` pairs, a `\r` at the end, and text like the marker.
  const data = encoder.encode(
    "PAR1\r\n\x00\x01\r\r\n__exception__ \r\n__exception__\r\nzzzzzzzzzzzzzzzz\r\nend\r",
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

  /** Scans the chunks as a consumer gets them: each result is copied. */
  function scan(chunks: Uint8Array[]) {
    const scanner = new BinaryExceptionScanner(tag);
    const out: Uint8Array[] = [];
    let error: Error | undefined;
    for (const chunk of chunks) {
      const r = scanner.push(chunk);
      out.push(r.data.slice());
      if (r.error !== undefined) {
        error = r.error;
        break;
      }
    }
    if (error === undefined) {
      const r = scanner.end();
      out.push(r.data.slice());
      error = r.error;
    }
    return { bytes: join(...out), error };
  }

  function expectServerError(error: Error | undefined) {
    expect(error).toBeInstanceOf(ClickHouseError);
    expect((error as ClickHouseError).code).toBe("395");
    expect((error as ClickHouseError).type).toBe(
      "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
    );
  }

  it("gives binary data with \\r\\n and marker-like text unchanged", () => {
    const { bytes, error } = scan([data]);
    expect(error).toBeUndefined();
    expect(bytes).toEqual(data);
  });

  it("gives the data unchanged for every split into two and three chunks", () => {
    for (let i = 0; i <= data.length; i++) {
      for (let j = i; j <= data.length; j++) {
        const chunks = [
          data.subarray(0, i),
          data.subarray(i, j),
          data.subarray(j),
        ];
        const { bytes, error } = scan(chunks);
        expect(error, `${i}/${j}`).toBeUndefined();
        expect(bytes, `${i}/${j}`).toEqual(data);
      }
    }
  });

  it("gives the data unchanged in 1-byte chunks", () => {
    const chunks = Array.from(data, (b) => Uint8Array.of(b));
    const { bytes, error } = scan(chunks);
    expect(error).toBeUndefined();
    expect(bytes).toEqual(data);
  });

  it("gives the server error and the bytes before it, for every split", () => {
    const body = join(data, block());
    for (let cut = 0; cut <= body.length; cut++) {
      const { bytes, error } = scan([
        body.subarray(0, cut),
        body.subarray(cut),
      ]);
      expectServerError(error);
      expect(bytes, `cut at ${cut}`).toEqual(data);
    }
    const oneByte = scan(Array.from(body, (b) => Uint8Array.of(b)));
    expectServerError(oneByte.error);
    expect(oneByte.bytes).toEqual(data);
  });

  it("gives the error as soon as the block is complete, before the end", () => {
    const scanner = new BinaryExceptionScanner(tag);
    const r = scanner.push(join(data, block()));
    expectServerError(r.error);
  });

  it("ignores a block opening with another tag", () => {
    const other = join(data, block("zzzzzzzzzzzzzzzz"));
    const { bytes, error } = scan([other]);
    expect(error).toBeUndefined();
    expect(bytes).toEqual(other);
  });

  it("gives an error for a block that the response cuts", () => {
    const full = block();
    for (
      let end = 2 + "__exception__\r\n".length + tag.length;
      end < full.length;
      end++
    ) {
      const { bytes, error } = scan([join(data, full.subarray(0, end))]);
      expect(error?.message, `end at ${end}`).toContain(
        "exception block is incomplete",
      );
      expect(bytes).toEqual(data);
    }
  });

  it("gives the held bytes as data at the end: a \\r, or a cut block opening", () => {
    // `end()` is also called when the connection fails: the bytes that came
    // are data, if they do not start a block with the tag.
    const opening = encoder.encode(`\r\n__exception__\r\n${tag}`);
    for (let n = 1; n < opening.length; n++) {
      const cut = join(data, opening.subarray(0, n));
      const { bytes, error } = scan([cut]);
      expect(error, `${n} bytes`).toBeUndefined();
      expect(bytes, `${n} bytes`).toEqual(cut);
    }
  });

  it("gives an error for a block that is longer than 16 KiB", () => {
    const scanner = new BinaryExceptionScanner(tag);
    const opening = encoder.encode(`\r\n__exception__\r\n${tag}\r\n`);
    expect(scanner.push(opening).error).toBeUndefined();
    const r = scanner.push(new Uint8Array(17 * 1024).fill(0x41));
    expect(r.error?.message).toContain("exception block is malformed");
  });

  it("gives nothing after an error", () => {
    const scanner = new BinaryExceptionScanner(tag);
    expectServerError(scanner.push(join(data, block())).error);
    expect(scanner.push(data)).toEqual({ data: new Uint8Array(0) });
    expect(scanner.end()).toEqual({ data: new Uint8Array(0) });
  });

  it("does not use the memory of the chunks that it gave", () => {
    // The consumer can transfer or change the buffer of a chunk (for example,
    // postMessage(chunk, [chunk.buffer]) to a worker).
    const body = join(data, block());
    for (let cut = 1; cut < body.length; cut++) {
      const scanner = new BinaryExceptionScanner(tag);
      const first = body.slice(0, cut);
      const r1 = scanner.push(first);
      const got = r1.data.slice();
      first.fill(0); // destroys the bytes of the chunk and of `r1.data`
      const r2 = scanner.push(body.slice(cut));
      const error = r1.error ?? r2.error;
      expectServerError(error);
      expect(join(got, r2.data), `cut at ${cut}`).toEqual(data);
    }
  });
});
