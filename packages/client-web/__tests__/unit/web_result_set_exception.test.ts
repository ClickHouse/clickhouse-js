import { describe, it, expect, vi } from "vitest";
import { ClickHouseError, ResultSet } from "../../src";
import type { JSONHandling, Row } from "../../src";

const message =
  'Code: 395. DB::Exception: boom: "日本語"\nnext line. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)';
const exceptionRow = JSON.stringify({ exception: message }) + "\n";

describe.each(["JSONEachRow", "JSONStringsEachRow"] as const)(
  "[Web] %s exception rows",
  (format) => {
    function makeResultSet(chunks: Uint8Array[], jsonHandling?: JSONHandling) {
      return new ResultSet(
        new ReadableStream({
          start(controller) {
            for (const chunk of chunks) controller.enqueue(chunk);
            controller.close();
          },
        }),
        format,
        "test",
        { "x-clickhouse-exception-tag": "test-tag" },
        jsonHandling,
      );
    }

    for (const chunkSize of [1, 13, Infinity]) {
      it(`rejects json() with an error split into chunks of ${chunkSize} bytes`, async () => {
        const bytes = new TextEncoder().encode('{"n":"1"}\n' + exceptionRow);
        const chunks: Uint8Array[] = [];
        for (let i = 0; i < bytes.length; i += chunkSize) {
          chunks.push(bytes.subarray(i, i + chunkSize));
        }
        const rs = makeResultSet(chunks);
        const result = rs.json();
        await expect(result).rejects.toBeInstanceOf(ClickHouseError);
        await expect(result).rejects.toMatchObject({
          code: "395",
          type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
          message: 'boom: "日本語"\nnext line. ',
        });
      });
    }

    it("returns the preceding rows before the error without calling Row.json()", async () => {
      const rs = makeResultSet([
        new TextEncoder().encode('{"n":"1"}\n' + exceptionRow),
      ]);
      const reader = rs.stream().getReader();
      const first = await reader.read();
      expect(first.value?.map((row) => row.text)).toEqual(['{"n":"1"}']);
      const next = reader.read();
      await expect(next).rejects.toBeInstanceOf(ClickHouseError);
      await expect(next).rejects.toMatchObject({ code: "395" });
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
    ])("keeps data rows %j and %j", async (first, second) => {
      const bytes = new TextEncoder().encode(
        [first, second].map((row) => JSON.stringify(row) + "\n").join(""),
      );
      expect(await makeResultSet([bytes]).json()).toEqual([first, second]);
    });

    it("keeps the custom JSON parser lazy", async () => {
      const parse = vi.fn(JSON.parse);
      const rs = makeResultSet(
        [
          new TextEncoder().encode(
            '{"n":"1"}\n{"exception":"ordinary data"}\n',
          ),
        ],
        { parse, stringify: JSON.stringify },
      );
      const received: Row[] = [];
      const reader = rs.stream().getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received.push(...value);
      }
      expect(parse).not.toHaveBeenCalled();
      expect(received[0]!.json()).toEqual({ n: "1" });
      expect(parse).toHaveBeenCalledTimes(1);
    });
  },
);
