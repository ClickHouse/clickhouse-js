import { describe, it, expect } from "vitest";
import { ClickHouseError, ResultSet } from "../../src";

// See https://github.com/ClickHouse/clickhouse-js/issues/1167

const tag = "abcdefghijklmnop";
const message =
  "Code: 395. DB::Exception: boom. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)";
const rows = '{"n":1}\n{"n":2}\n';
// The tagged exception block of ClickHouse 25.11+.
const block = `\r\n__exception__\r\n${tag}\r\n${message}\n${message.length + 1} ${tag}\r\n__exception__\r\n`;
// The in-band error row (`http_write_exception_in_output_format=1`).
const errorRow = `{"exception": "${message}"}\n`;

const layouts = [
  ["rows and the error block in one chunk", [rows + block]],
  ["the error block in a separate chunk", [rows, block]],
  ["rows and the error row in one chunk", [rows + errorRow]],
  ["the error row in a separate chunk", [rows, errorRow]],
  ["the error row with no final newline", [rows + errorRow.trimEnd()]],
  [
    "the error row with no final newline, in a separate chunk",
    [rows, errorRow.trimEnd()],
  ],
] as const;

function makeResultSet(chunks: readonly string[]) {
  const encoder = new TextEncoder();
  return new ResultSet(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    "JSONEachRow",
    "test",
    { "x-clickhouse-exception-tag": tag },
  );
}

async function consumeSlowly(rs: ResultSet<"JSONEachRow">) {
  const received: unknown[] = [];
  try {
    for await (const batch of rs.stream()) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      received.push(...batch.map((row) => row.json()));
    }
  } catch (err) {
    return { received, error: err };
  }
  return { received, error: undefined };
}

describe("[Web] mid-stream errors with a slow consumer", () => {
  it.each(layouts)("gets all rows, then the error: %s", async (_, chunks) => {
    const { received, error } = await consumeSlowly(makeResultSet(chunks));
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error).toMatchObject({ code: "395" });
  });

  it.each(layouts)("rejects json(): %s", async (_, chunks) => {
    await expect(makeResultSet(chunks).json()).rejects.toMatchObject({
      code: "395",
    });
  });

  it("detects an error-only body with no final newline", async () => {
    const { received, error } = await consumeSlowly(
      makeResultSet([errorRow.trimEnd()]),
    );
    expect(received).toEqual([]);
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error).toMatchObject({ code: "395" });
  });

  it("drops an incomplete data row at the end of the body, as before", async () => {
    expect(await makeResultSet([rows + '{"n":3}']).json()).toEqual([
      { n: 1 },
      { n: 2 },
    ]);
  });
});
