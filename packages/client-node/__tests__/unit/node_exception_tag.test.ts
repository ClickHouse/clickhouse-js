import { describe, it, expect } from "vitest";
import type { DataFormat } from "@clickhouse/client-common";
import { Readable } from "stream";
import { ResultSet } from "../../src";
import { guid } from "../../../client-common/__tests__/utils/guid";

// Regression coverage for the in-band mid-stream exception detector. When an
// error occurs after a 200 response has started streaming, ClickHouse (25.11+)
// terminates the body with `<tag>\r\n__exception__\r\n`, echoing the random
// per-response token from the `x-clickhouse-exception-tag` header. The detector
// must fire ONLY on that real trailer, never on a stray `\r\n` in a successful
// body (binary Parquet, or CRLF-terminated CSV/TSV rows).
describe("[Node.js] mid-stream exception tag detection", () => {
  const tag = "abcdefghijklmnop";

  function makeResultSet(chunks: Buffer[], format: DataFormat = "CSV") {
    return ResultSet.instance({
      stream: Readable.from(chunks),
      format,
      query_id: guid(),
      log_error: () => undefined,
      response_headers: { "x-clickhouse-exception-tag": tag },
    });
  }

  async function collectRowText(
    rs: ReturnType<typeof makeResultSet>,
  ): Promise<string[]> {
    const rows: string[] = [];
    for await (const chunk of rs.stream()) {
      for (const row of chunk) {
        rows.push(row.text);
      }
    }
    return rows;
  }

  it("streams a successful CRLF-terminated CSV body to completion", async () => {
    const rs = makeResultSet([Buffer.from("0\r\n1\r\n2\r\n")]);
    const rows = await collectRowText(rs);
    expect(rows).toHaveLength(3);
  });

  it("streams a binary body containing \\r\\n to completion", async () => {
    const parquetish = Buffer.from([
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
      collectRowText(makeResultSet([Buffer.from(body, "latin1")])),
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
      collectRowText(makeResultSet([Buffer.from(body, "latin1")])),
    ).rejects.toThrow("Value passed to 'throwIf' function is non-zero");
  });
});
