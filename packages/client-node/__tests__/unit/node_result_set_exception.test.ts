import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { ClickHouseError, ResultSet } from "../../src";
import type { JSONHandling, Row } from "../../src";

const message =
  'Code: 395. DB::Exception: boom: "日本語"\nnext line. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)';
// The server separates the exception value with a space. Data rows are compact.
const exceptionRow = '{"exception": ' + JSON.stringify(message) + "}\n";

describe.each(["JSONEachRow", "JSONStringsEachRow"] as const)(
  "[Node.js] %s exception rows",
  (format) => {
    function makeResultSet(chunks: Uint8Array[], jsonHandling?: JSONHandling) {
      return ResultSet.instance({
        stream: Readable.from(chunks),
        format,
        query_id: "test",
        log_error: vi.fn(),
        response_headers: { "x-clickhouse-exception-tag": "test-tag" },
        jsonHandling,
      });
    }

    function errorChunks(
      chunkSize: number,
      firstRow: object = { n: "1" },
    ): Buffer[] {
      const bytes = Buffer.from(JSON.stringify(firstRow) + "\n" + exceptionRow);
      const chunks: Buffer[] = [];
      for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(bytes.subarray(i, i + chunkSize));
      }
      return chunks;
    }

    for (const chunkSize of [1, 13, Infinity]) {
      it.each([{ n: "1" }, { exception: message }])(
        `rejects json() after %j with chunks of ${chunkSize} bytes`,
        async (firstRow) => {
          const rs = makeResultSet(errorChunks(chunkSize, firstRow));
          const result = rs.json();
          await expect(result).rejects.toBeInstanceOf(ClickHouseError);
          await expect(result).rejects.toMatchObject({
            code: "395",
            type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
            message: 'boom: "日本語"\nnext line.',
          });
        },
      );

      it.each([{ n: "1" }, { exception: message }])(
        `rejects an async iterator after %j with chunks of ${chunkSize} bytes`,
        async (firstRow) => {
          const rs = makeResultSet(errorChunks(chunkSize, firstRow));
          const received: unknown[] = [];
          const consume = async () => {
            for await (const rows of rs.stream()) {
              received.push(...rows.map((row) => row.json()));
            }
          };
          await expect(consume()).rejects.toBeInstanceOf(ClickHouseError);
          expect(received).toEqual([firstRow]);
        },
      );
    }

    it("emits the preceding rows before the error without calling Row.json()", async () => {
      const rs = makeResultSet([Buffer.from('{"n":"1"}\n' + exceptionRow)]);
      const received: string[] = [];
      const error = await new Promise<Error>((resolve) => {
        const stream = rs.stream();
        stream.on("data", (rows) =>
          received.push(...rows.map((row) => row.text)),
        );
        stream.on("error", resolve);
        stream.on("end", () => resolve(new Error("No stream error")));
      });
      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error).toMatchObject({ code: "395" });
      expect(received).toEqual(['{"n":"1"}']);
    });

    it.each([
      [{ exception: "boom" }, { exception: message }],
      [{ exception: message }, { exception: message }],
      [{ exception: null }, { exception: message }],
      [
        { n: "1", exception: message },
        { n: "2", exception: message },
      ],
      [{ n: "1" }, { exception: 395 }],
      [{ n: "1" }, { exception: "ordinary data" }],
      [{ n: "1" }, { exception: { nested: message } }],
      [{ n: "1" }, { exception: message, n: "2" }],
      [{ n: "1" }, { exception: 'a"} b', n: "2" }],
      [{ n: "1" }, { exception: "a\\", n: "2" }],
    ])("keeps data rows %j and %j", async (first, second) => {
      const rs = makeResultSet([
        Buffer.from(
          [first, second].map((row) => JSON.stringify(row) + "\n").join(""),
        ),
      ]);
      expect(await rs.json()).toEqual([first, second]);
    });

    describe("with exception as the first of several columns", () => {
      const dataRows = Array.from(
        { length: 100 },
        (_, n) => JSON.stringify({ exception: message, n: String(n) }) + "\n",
      ).join("");
      // The message has escaped quotes, `"}` and a trailing backslash.
      const escapedMessage =
        'Code: 395. DB::Exception: a"} b. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) \\';
      const escapedExceptionRow =
        '{"exception": ' + JSON.stringify(escapedMessage) + "}\n";

      function chunksOf(text: string, chunkSize: number): Buffer[] {
        const bytes = Buffer.from(text);
        const chunks: Buffer[] = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
          chunks.push(bytes.subarray(i, i + chunkSize));
        }
        return chunks;
      }

      function lazyJSONHandling() {
        const nativeParse = JSON.parse;
        const parse = vi.fn((text: string) => nativeParse(text));
        return { parse, stringify: JSON.stringify };
      }

      it("does not parse each row eagerly", async () => {
        const jsonHandling = lazyJSONHandling();
        const nativeParse = vi.spyOn(JSON, "parse");
        try {
          const rs = makeResultSet(chunksOf(dataRows, 7), jsonHandling);
          const received: Row[] = [];
          for await (const rows of rs.stream()) received.push(...rows);
          expect(received).toHaveLength(100);
          expect(nativeParse).not.toHaveBeenCalled();
          expect(jsonHandling.parse).not.toHaveBeenCalled();
          expect(received[99]!.json()).toEqual({ exception: message, n: "99" });
        } finally {
          nativeParse.mockRestore();
        }
      });

      it("rejects an error row with escaped characters", async () => {
        const jsonHandling = lazyJSONHandling();
        const nativeParse = vi.spyOn(JSON, "parse");
        try {
          const rs = makeResultSet(
            chunksOf(dataRows + escapedExceptionRow, 7),
            jsonHandling,
          );
          const result = rs.json();
          await expect(result).rejects.toBeInstanceOf(ClickHouseError);
          await expect(result).rejects.toMatchObject({
            code: "395",
            type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
            message: 'a"} b.',
          });
          // Only the error message is decoded eagerly.
          expect(nativeParse).toHaveBeenCalledTimes(1);
        } finally {
          nativeParse.mockRestore();
        }
      });
    });

    it("keeps the custom JSON parser lazy", async () => {
      const parse = vi.fn(JSON.parse);
      const rs = makeResultSet(
        [Buffer.from('{"n":"1"}\n{"exception":"ordinary data"}\n')],
        { parse, stringify: JSON.stringify },
      );
      const received: Row[] = [];
      for await (const rows of rs.stream()) received.push(...rows);
      expect(parse).not.toHaveBeenCalled();
      expect(received[0]!.json()).toEqual({ n: "1" });
      expect(parse).toHaveBeenCalledTimes(1);
    });
  },
);
