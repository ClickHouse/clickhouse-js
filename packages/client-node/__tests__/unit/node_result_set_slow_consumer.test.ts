import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
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
  [
    "one row in each chunk, then the error block",
    ['{"n":1}\n', '{"n":2}\n', block],
  ],
  ["rows and the error row in one chunk", [rows + errorRow]],
  ["the error row in a separate chunk", [rows, errorRow]],
  ["the error row with no final newline", [rows + errorRow.trimEnd()]],
  [
    "the error row with no final newline, in a separate chunk",
    [rows, errorRow.trimEnd()],
  ],
] as const;

function bufferSource(chunks: readonly string[]): Readable {
  return Readable.from(chunks.map((chunk) => Buffer.from(chunk)));
}

/** Gives the chunks, then fails like a response that the server aborts. */
function abortedSource(chunks: readonly string[]): Readable {
  const source = new Readable({ read() {} });
  for (const chunk of chunks) source.push(Buffer.from(chunk));
  setImmediate(() =>
    source.destroy(Object.assign(new Error("aborted"), { code: "ECONNRESET" })),
  );
  return source;
}

function makeResultSet(source: Readable) {
  const log_error = vi.fn();
  const rs = ResultSet.instance({
    stream: source,
    format: "JSONEachRow",
    query_id: "test",
    log_error,
    response_headers: { "x-clickhouse-exception-tag": tag },
  });
  return { rs, log_error };
}

const consumers = {
  async "a slow async iterator"(rs: ResultSet<"JSONEachRow">) {
    const received: unknown[] = [];
    try {
      for await (const batch of rs.stream()) {
        await sleep(20);
        received.push(...batch.map((row) => row.json()));
      }
    } catch (err) {
      return { received, error: err };
    }
    return { received, error: undefined };
  },
  async "'data' listeners that pause"(rs: ResultSet<"JSONEachRow">) {
    const received: unknown[] = [];
    const stream = rs.stream();
    const error = await new Promise((resolve) => {
      stream.on("data", (batch) => {
        received.push(...batch.map((row) => row.json()));
        stream.pause();
        setTimeout(() => stream.resume(), 20);
      });
      stream.on("error", resolve);
      stream.on("end", () => resolve(undefined));
    });
    return { received, error };
  },
  async "'readable' with read()"(rs: ResultSet<"JSONEachRow">) {
    const received: unknown[] = [];
    const stream = rs.stream();
    await sleep(20);
    const error = await new Promise((resolve) => {
      stream.on("readable", () => {
        let batch;
        while ((batch = stream.read()) !== null) {
          received.push(...batch.map((row) => row.json()));
        }
      });
      stream.on("error", resolve);
      stream.on("end", () => resolve(undefined));
    });
    return { received, error };
  },
};

describe("[Node.js] mid-stream errors with a slow consumer", () => {
  for (const [name, consume] of Object.entries(consumers)) {
    describe(name, () => {
      it.each(layouts)(
        "gets all rows, then the error: %s",
        async (_, chunks) => {
          const { rs, log_error } = makeResultSet(bufferSource(chunks));
          const { received, error } = await consume(rs);
          expect(received).toEqual([{ n: 1 }, { n: 2 }]);
          expect(error).toBeInstanceOf(ClickHouseError);
          expect(error).toMatchObject({ code: "395" });
          expect(log_error).toHaveBeenCalledWith(error);
        },
      );

      it.each(layouts)(
        "gets all rows, then the server error, when the response is aborted after the error: %s",
        async (_, chunks) => {
          const source = abortedSource(chunks);
          const { rs } = makeResultSet(source);
          const { received, error } = await consume(rs);
          expect(received).toEqual([{ n: 1 }, { n: 2 }]);
          expect(error).toBeInstanceOf(ClickHouseError);
          expect(error).toMatchObject({ code: "395" });
          expect(source.destroyed).toBe(true);
        },
      );
    });
  }

  it.each(layouts)("rejects json(): %s", async (_, chunks) => {
    const { rs } = makeResultSet(bufferSource(chunks));
    await expect(rs.json()).rejects.toMatchObject({ code: "395" });
  });

  it("detects an error-only body with no final newline", async () => {
    const { rs } = makeResultSet(bufferSource([errorRow.trimEnd()]));
    const { received, error } = await consumers["a slow async iterator"](rs);
    expect(received).toEqual([]);
    expect(error).toBeInstanceOf(ClickHouseError);
    expect(error).toMatchObject({ code: "395" });
  });

  it("drops an incomplete data row at the end of the body, as before", async () => {
    const { rs } = makeResultSet(bufferSource([rows + '{"n":3}']));
    expect(await rs.json()).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it("ignores the data after the error", async () => {
    const { rs } = makeResultSet(
      bufferSource([rows + errorRow, '{"n":3}\n', '{"n":4}\n']),
    );
    const { received, error } = await consumers["a slow async iterator"](rs);
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(error).toMatchObject({ code: "395" });
  });

  it("destroys the source when the consumer stops early", async () => {
    const source = new Readable({ read() {} });
    source.push(Buffer.from(rows));
    const { rs, log_error } = makeResultSet(source);
    for await (const _ of rs.stream()) {
      break;
    }
    await sleep(0);
    expect(source.destroyed).toBe(true);
  });

  it.each(["CSV", "TabSeparated"] as const)(
    "keeps a complete CRLF row at the end of the body when a network error comes (%s)",
    async (format) => {
      const rs = ResultSet.instance({
        stream: abortedSource(["one\r\ntwo\r\n"]),
        format,
        query_id: "test",
        log_error: vi.fn(),
        response_headers: { "x-clickhouse-exception-tag": tag },
      });
      const received: string[] = [];
      let error: unknown;
      try {
        for await (const batch of rs.stream()) {
          for (const row of batch) received.push(row.text);
          await sleep(20);
        }
      } catch (err) {
        error = err;
      }
      expect(received).toEqual(["one\r", "two\r"]);
      expect(error).toMatchObject({ code: "ECONNRESET" });
    },
  );

  // A network error can cut the exception block opening after any byte. The
  // bytes of the opening must never become rows, and a complete row before
  // them must stay (#1167).
  describe("a network error that cuts the exception block opening", () => {
    const opening = `\r\n__exception__\r\n${tag}`;
    const formats = [
      ["JSONEachRow", '{"n":1}\n{"n":2}\n', ['{"n":1}', '{"n":2}']],
      ["JSONStringsEachRow", '{"n":"1"}\n', ['{"n":"1"}']],
      ["CSV", "one\r\ntwo\r\n", ["one\r", "two\r"]],
      ["TabSeparated", "one\r\n", ["one\r"]],
    ] as const;
    for (const [format, data, dataRows] of formats) {
      const isJSON = format.startsWith("JSON");
      for (let cut = 0; cut <= opening.length; cut++) {
        // Only `\r\n` came: in CSV/TSV, that is also a complete empty row.
        const expected =
          cut === 2 && !isJSON ? [...dataRows, "\r"] : [...dataRows];
        // With the whole opening, the client knows that a server error came.
        const expectedError =
          cut === opening.length
            ? {
                message:
                  "there was an error in the stream, but the exception block is incomplete",
              }
            : { code: "ECONNRESET" };
        for (const split of ["one chunk", "1-byte chunks"]) {
          it(`${format}: cut after ${cut} bytes, ${split}`, async () => {
            const body = data + opening.slice(0, cut);
            const chunks =
              split === "one chunk" ? [body] : Array.from(body, (c) => c);
            const rs = ResultSet.instance({
              stream: abortedSource(chunks),
              format,
              query_id: "test",
              log_error: vi.fn(),
              response_headers: { "x-clickhouse-exception-tag": tag },
            });
            const received: string[] = [];
            let error: unknown;
            try {
              for await (const batch of rs.stream()) {
                for (const row of batch) received.push(row.text);
              }
            } catch (err) {
              error = err;
            }
            expect(received).toEqual(expected);
            expect(error).toMatchObject(expectedError);
          });
        }
        if (isJSON) {
          it(`${format}: json() rejects with the network error, cut after ${cut} bytes`, async () => {
            const rs = ResultSet.instance({
              stream: abortedSource([data + opening.slice(0, cut)]),
              format,
              query_id: "test",
              log_error: vi.fn(),
              response_headers: { "x-clickhouse-exception-tag": tag },
            });
            await expect(rs.json()).rejects.toMatchObject(expectedError);
          });
        }
      }
    }
  });

  // Cut data and a cut opening can be the same bytes. The client keeps the
  // complete CSV/TSV rows (#1167).
  it.each([
    ["data that starts with _", "one\r\ntwo\r\n_", ["one\r", "two\r"]],
    [
      "data that starts like the marker",
      "one\r\ntwo\r\n__exc",
      ["one\r", "two\r"],
    ],
    ["an empty row, then data", "one\r\n\r\n", ["one\r", "\r"]],
    // The one loss: a data line that is exactly the marker, then the first
    // bytes of the tag, at the cut.
    [
      "a data line that is the marker",
      `one\r\n__exception__\r\n${tag.slice(0, 1)}`,
      ["one\r"],
    ],
  ])(
    "keeps the complete CSV/TSV rows when a network error cuts %s",
    async (_, body, expected) => {
      for (const format of ["CSV", "TabSeparated"] as const) {
        for (const chunks of [[body], Array.from(body)]) {
          const rs = ResultSet.instance({
            stream: abortedSource(chunks),
            format,
            query_id: "test",
            log_error: vi.fn(),
            response_headers: { "x-clickhouse-exception-tag": tag },
          });
          const received: string[] = [];
          let error: unknown;
          try {
            for await (const batch of rs.stream()) {
              for (const row of batch) received.push(row.text);
            }
          } catch (err) {
            error = err;
          }
          expect({ format, received }).toEqual({ format, received: expected });
          expect(error).toMatchObject({ code: "ECONNRESET" });
        }
      }
    },
  );

  it("gives the rows before a network error, then the network error", async () => {
    const source = new Readable({ read() {} });
    source.push(Buffer.from(rows));
    setImmediate(() => source.destroy(new Error("socket hang up")));
    const { rs, log_error } = makeResultSet(source);
    const { received, error } = await consumers["a slow async iterator"](rs);
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(error).toMatchObject({ message: "socket hang up" });
    expect(log_error).toHaveBeenCalledWith(error);
  });

  it("stops at once when the caller aborts the request", async () => {
    const source = new Readable({ read() {} });
    for (let n = 0; n < 100; n++) source.push(Buffer.from(`{"n":${n}}\n`));
    const abortError = Object.assign(new Error("aborted"), {
      name: "AbortError",
    });
    setImmediate(() => source.destroy(abortError));
    const { rs, log_error } = makeResultSet(source);
    const { received, error } = await consumers["a slow async iterator"](rs);
    expect(received.length).toBeLessThan(100);
    expect(error).toBe(abortError);
    expect(log_error).not.toHaveBeenCalled();
  });

  // More batches than the buffer of the stream holds (16), so the chunk with
  // the error is still in the write buffer when the server aborts.
  it.each([
    ["an error block", block],
    ["an error row", errorRow],
    ["an error row with no final newline", errorRow.trimEnd()],
  ])(
    "gives 100 rows, then the server error, to a slow consumer when the response is aborted after %s",
    async (_, error) => {
      const chunks = Array.from({ length: 100 }, (_, n) => `{"n":${n}}\n`);
      const { rs } = makeResultSet(abortedSource([...chunks, error]));
      const received: unknown[] = [];
      const consume = async () => {
        for await (const batch of rs.stream()) {
          await sleep(1);
          received.push(...batch);
        }
      };
      await expect(consume()).rejects.toMatchObject({ code: "395" });
      expect(received).toHaveLength(100);
    },
  );

  it("fails when the source closes with no error", async () => {
    const source = new Readable({ read() {} });
    source.push(Buffer.from(rows));
    setImmediate(() => source.destroy());
    const { rs } = makeResultSet(source);
    const { received, error } = await consumers["a slow async iterator"](rs);
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(error).toMatchObject({ code: "ERR_STREAM_PREMATURE_CLOSE" });
  });

  it("rejects json() after close()", async () => {
    const { rs, log_error } = makeResultSet(bufferSource([rows]));
    rs.close();
    await sleep(0);
    await expect(rs.json()).rejects.toThrow("ResultSet has been closed");
    expect(log_error).not.toHaveBeenCalled();
  });

  it("fails a consumer that reads once for each 'readable' event", async () => {
    const { rs } = makeResultSet(bufferSource([rows + errorRow]));
    const stream = rs.stream();
    const received: unknown[] = [];
    const error = await new Promise((resolve) => {
      stream.on("readable", () => {
        const batch = stream.read();
        if (batch !== null) received.push(...batch.map((row) => row.json()));
      });
      stream.on("error", resolve);
      stream.on("end", () => resolve(undefined));
    });
    expect(received).toEqual([{ n: 1 }, { n: 2 }]);
    expect(error).toMatchObject({ code: "395" });
  });

  it("stops at close() when rows and the server error are pending", async () => {
    const span = {
      setAttributes: vi.fn(),
      setStatus: vi.fn(),
      recordException: vi.fn(),
      end: vi.fn(),
    };
    const log_error = vi.fn();
    const rs = ResultSet.instance({
      stream: bufferSource(['{"n":1}\n', '{"n":2}\n', errorRow]),
      format: "JSONEachRow",
      query_id: "test",
      log_error,
      response_headers: {},
      span,
    });
    const stream = rs.stream();
    const error = new Promise((resolve) => stream.on("error", resolve));
    await sleep(20); // The server error is found; the rows are not read.
    rs.close();
    expect(await error).toMatchObject({ message: "ResultSet has been closed" });
    expect(stream.destroyed).toBe(true);
    await sleep(0);
    expect(log_error).not.toHaveBeenCalled();
    expect(span.end).toHaveBeenCalledTimes(1);
    expect(span.recordException).not.toHaveBeenCalled();
  });
});
