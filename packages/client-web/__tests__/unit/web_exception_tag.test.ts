import { describe, it, expect } from "vitest";
import type { DataFormat } from "@clickhouse/client-common";
import { guid } from "@test/utils";
import { ResultSet } from "../../src";

// Regression coverage for the in-band mid-stream exception detector. When an
// error occurs after a 200 response has started streaming, ClickHouse (25.11+)
// terminates the body with `<tag>\r\n__exception__\r\n`, echoing the random
// per-response token from the `x-clickhouse-exception-tag` header. The detector
// must fire ONLY on that real trailer, never on a stray `\r\n` in a successful
// body (binary Parquet, or CRLF-terminated CSV/TSV rows).
describe("[Web] mid-stream exception tag detection", () => {
  const tag = "abcdefghijklmnop";

  function makeResultSet(chunks: Uint8Array[], format: DataFormat = "CSV") {
    return new ResultSet(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(chunk);
          }
          controller.close();
        },
      }),
      format,
      guid(),
      { "x-clickhouse-exception-tag": tag },
    );
  }

  async function collectRowText(
    rs: ReturnType<typeof makeResultSet>,
  ): Promise<string[]> {
    const rows: string[] = [];
    const reader = rs.stream().getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const row of value) {
        rows.push(row.text);
      }
    }
    return rows;
  }

  it("streams a successful CRLF-terminated CSV body to completion", async () => {
    const rs = makeResultSet([new TextEncoder().encode("0\r\n1\r\n2\r\n")]);
    const rows = await collectRowText(rs);
    expect(rows).toHaveLength(3);
  });

  it("streams a binary body containing \\r\\n to completion", async () => {
    const parquetish = new Uint8Array([
      0x50,
      0x41,
      0x52,
      0x31, // "PAR1"
      0x0d,
      0x0a, // stray \r\n
      0x00,
      0x01,
      0x02,
      0x03,
      0x0d,
      0x0a, // stray \r\n
      0xff,
      0xfe,
      0xfd,
    ]);
    await expect(
      collectRowText(makeResultSet([parquetish], "Parquet")),
    ).resolves.toBeInstanceOf(Array);
  });

  it("still surfaces a genuine mid-stream exception with the real message", async () => {
    const errMsg =
      "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: " +
      "while executing 'FUNCTION throwIf(equals(number, 3))'. " +
      "(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.5.1.882)";
    const body =
      "0\n1\n2\n" +
      "\r\n__exception__\r\n" +
      tag +
      "\r\n" +
      errMsg +
      "\n" +
      (errMsg.length + 1) +
      " " +
      tag +
      "\r\n__exception__\r\n";
    await expect(
      collectRowText(makeResultSet([new TextEncoder().encode(body)])),
    ).rejects.toThrow("Value passed to 'throwIf' function is non-zero");
  });

  // With output_format_*_crlf_end_of_line the row terminator is itself `\r\n`,
  // so the `\r`-before-`\n` pre-filter matches at the FIRST row rather than at
  // the trailer. Detection must still surface the genuine server error
  // (extractErrorAtTheEndOfChunk always parses the trailer at the end of the
  // chunk, independent of which newline triggered the check) — not a bogus
  // row-keyed error — and must not hang.
  it("surfaces the real exception message when preceding rows are CRLF-terminated", async () => {
    const errMsg =
      "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: " +
      "while executing 'FUNCTION throwIf(equals(number, 3))'. " +
      "(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.5.1.882)";
    const body =
      "0\r\n1\r\n2\r\n" +
      "\r\n__exception__\r\n" +
      tag +
      "\r\n" +
      errMsg +
      "\n" +
      (errMsg.length + 1) +
      " " +
      tag +
      "\r\n__exception__\r\n";
    await expect(
      collectRowText(makeResultSet([new TextEncoder().encode(body)])),
    ).rejects.toThrow("Value passed to 'throwIf' function is non-zero");
  });

  // The exception block can be split across chunks at any byte (network reads,
  // HTTP response decompression). It must be collected until it is complete:
  // its bytes must never be emitted as rows, and the error must contain the
  // real server message.
  describe("exception block split across chunks", () => {
    const encoder = new TextEncoder();
    const errMsg =
      "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: " +
      "while executing 'FUNCTION throwIf(equals(number, 3))'. " +
      "(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.9.1.1629)";
    const serverMessage = "Value passed to 'throwIf' function is non-zero";
    const exceptionBlock = (msg: string) =>
      `\r\n__exception__\r\n${tag}\r\n${msg}\n${msg.length + 1} ${tag}\r\n__exception__\r\n`;

    async function collect(
      rs: ReturnType<typeof makeResultSet>,
    ): Promise<{ rows: string[]; error: Error | undefined }> {
      const rows: string[] = [];
      const reader = rs.stream().getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const row of value) {
            rows.push(row.text);
          }
        }
      } catch (err) {
        return { rows, error: err as Error };
      }
      return { rows, error: undefined };
    }

    // A stream that fails can discard the rows that the consumer did not
    // read yet. The rows that reach it must be the first data rows, in order.
    function expectDataRows(rows: string[], dataRows: string[]) {
      expect(rows).toEqual(dataRows.slice(0, rows.length));
    }

    function inChunksOf(bytes: Uint8Array, size: number): Uint8Array[] {
      const chunks: Uint8Array[] = [];
      for (let i = 0; i < bytes.length; i += size) {
        chunks.push(bytes.subarray(i, i + size));
      }
      return chunks;
    }

    for (const { name, eol } of [
      { name: "LF", eol: "\n" },
      { name: "CRLF", eol: "\r\n" },
    ]) {
      // Row text is everything before the `\n`.
      const dataRows = ["0", "1", "2"].map((n) => n + eol.slice(0, -1));
      const body = encoder.encode(
        dataRows.map((row) => row + "\n").join("") + exceptionBlock(errMsg),
      );

      it(`surfaces the server error for every split into two chunks (${name} rows)`, async () => {
        for (let at = 1; at < body.length; at++) {
          const { rows, error } = await collect(
            makeResultSet([body.subarray(0, at), body.subarray(at)]),
          );
          expect(error?.message, `split at ${at}`).toContain(serverMessage);
          expectDataRows(rows, dataRows);
        }
      });

      it(`surfaces the server error when the response arrives one byte at a time (${name} rows)`, async () => {
        const { rows, error } = await collect(
          makeResultSet(inChunksOf(body, 1)),
        );
        expect(error?.message).toContain(serverMessage);
        expectDataRows(rows, dataRows);
      });
    }

    it("surfaces the full server error when a 16 KiB block spans several chunks", async () => {
      const details = "x".repeat(16 * 1024 - 400);
      const longMsg =
        "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: " +
        details +
        ". (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 26.9.1.1629)";
      const body = encoder.encode("0\n1\n2\n" + exceptionBlock(longMsg));
      const { rows, error } = await collect(
        makeResultSet(inChunksOf(body, 4096), "JSONEachRow"),
      );
      expect(error?.message).toContain(serverMessage);
      expect(error?.message).toContain(details);
      expectDataRows(rows, ["0", "1", "2"]);
    });

    it("returns an error when the response ends inside the block", async () => {
      const body = encoder.encode(
        "0\n1\n2\n" + exceptionBlock(errMsg).slice(0, -10),
      );
      const { error } = await collect(makeResultSet([body]));
      expect(error?.message).toContain("exception block is incomplete");
    });

    // When the bytes after a `\r\n` are not an exception block, they are
    // rows, wherever the response is split.
    for (const { name, body, expected } of [
      {
        name: "CRLF-terminated CSV rows",
        body: "0\r\n1\r\n2\r\n",
        expected: ["0\r", "1\r", "2\r"],
      },
      {
        name: "CRLF-terminated TSV rows, the last one is __exception__",
        body: "a\r\n__exception__\r\n",
        expected: ["a\r", "__exception__\r"],
      },
      {
        name: "binary data with a partial block marker after a \\r\\n",
        body: "PAR1\r\n__exc\x00\r\nend\r\n",
        expected: ["PAR1\r", "__exc\x00\r", "end\r"],
      },
    ]) {
      it(`streams a successful response split at any point (${name})`, async () => {
        const bytes = encoder.encode(body);
        const splits = [[bytes], inChunksOf(bytes, 1)];
        for (let at = 1; at < bytes.length; at++) {
          splits.push([bytes.subarray(0, at), bytes.subarray(at)]);
        }
        for (const chunks of splits) {
          const { rows, error } = await collect(makeResultSet(chunks));
          expect(error, `chunks ${chunks.length}`).toBeUndefined();
          expect(rows, `chunks ${chunks.length}`).toEqual(expected);
        }
      });
    }
  });
});
