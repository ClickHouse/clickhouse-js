import { describe, expect, it } from "vitest";
import Stream from "stream";
import { drainStream, ResultSet } from "../../src";
import { columnsWithDefaults } from "../../src/connection/native_connection";
import {
  NodeValuesEncoder,
  isJSONObjectEachRowEntry,
} from "../../src/utils/encoder";
import { defaultJSONHandling } from "../../src/common/index";
import type {
  ClickHouseSpan,
  ClickHouseSpanAttributes,
  ClickHouseSpanStatus,
} from "../../src/common/index";
import type { ResultChunk } from "../../src/result_chunk";

describe("drainStream", () => {
  it("reads the stream to its end", async () => {
    const readable = Stream.Readable.from(["a", "b", "c"]);
    await expect(drainStream(readable)).resolves.toBeUndefined();
    expect(readable.readableEnded).toBe(true);
  });

  it("resolves for a stream that has already ended", async () => {
    const readable = Stream.Readable.from([]);
    readable.resume();
    await new Promise((resolve) => readable.once("end", resolve));
    await expect(drainStream(readable)).resolves.toBeUndefined();
  });

  it("rejects with the error of the stream", async () => {
    const readable = new Stream.Readable({
      read() {
        this.destroy(new Error("broken"));
      },
    });
    await expect(drainStream(readable)).rejects.toThrow("broken");
  });

  it("rejects for a stream that has already failed", async () => {
    const readable = new Stream.Readable({ read() {} });
    readable.on("error", () => undefined);
    readable.destroy(new Error("broken"));
    await new Promise((resolve) => readable.once("close", resolve));
    await expect(drainStream(readable)).rejects.toThrow("broken");
  });
});

describe("[Native] columnsWithDefaults", () => {
  it("parses backtick-quoted column names when the column type also contains backticks", () => {
    const desc = [
      "`my col` Tuple(`a b` Int32, `c d` String)\tDEFAULT\t(1, 'x')",
      "`escaped\\`name` Tuple(`x` UInt8)\tDEFAULT\t(0)",
      "`doubled``tick` UInt64\tEPHEMERAL\t42",
      "plain String\tDEFAULT\t'hi'",
      "no_default UInt32",
    ].join("\n");
    expect(columnsWithDefaults(desc)).toEqual(
      new Set(["my col", "escaped`name", "doubled`tick", "plain"]),
    );
  });
});

describe("[Native] NodeValuesEncoder JSONObjectEachRow", () => {
  it("preserves outer object keys for JSONObjectEachRow", async () => {
    const encoder = new NodeValuesEncoder(defaultJSONHandling);
    const out = encoder.encodeValues(
      { first: { id: 1 }, second: { id: 2 } },
      "JSONObjectEachRow",
    );
    expect(out).toBeInstanceOf(Stream.Readable);
    const items: unknown[] = [];
    for await (const item of out as Stream.Readable) items.push(item);
    expect(items).toHaveLength(2);
    expect(isJSONObjectEachRowEntry(items[0])).toBe(true);
    expect(isJSONObjectEachRowEntry(items[1])).toBe(true);
    if (
      isJSONObjectEachRowEntry(items[0]) &&
      isJSONObjectEachRowEntry(items[1])
    ) {
      expect(items[0].key).toBe("first");
      expect(items[0].value).toEqual({ id: 1 });
      expect(items[1].key).toBe("second");
      expect(items[1].value).toEqual({ id: 2 });
    }
  });
});

class RecordedSpan implements ClickHouseSpan {
  attributes: ClickHouseSpanAttributes = {};
  status?: ClickHouseSpanStatus;
  exception?: Error;
  ended = 0;

  setAttributes(attributes: ClickHouseSpanAttributes) {
    this.attributes = { ...this.attributes, ...attributes };
  }
  setStatus(status: ClickHouseSpanStatus) {
    this.status = status;
  }
  recordException(error: Error) {
    this.exception = error;
  }
  end() {
    this.ended++;
  }
}

describe("[Native] ResultSet tracing decoded_bytes", () => {
  it("counts UTF-8 byte length rather than UTF-16 code units for text(), stream() and json()", async () => {
    const line = '{"s":"café 😀"}\n';
    const expectedBytes = Buffer.byteLength(line);
    expect(expectedBytes).toBeGreaterThan(line.length);

    // text()
    const textSpan = new RecordedSpan();
    const rsText = new ResultSet(
      Stream.Readable.from([{ text: () => line } satisfies ResultChunk], {
        objectMode: true,
      }),
      "JSONEachRow",
      "q1",
      undefined,
      undefined,
      undefined,
      textSpan,
    );
    expect(await rsText.text()).toBe(line);
    expect(textSpan.attributes["clickhouse.response.decoded_bytes"]).toBe(
      expectedBytes,
    );

    // stream()
    const streamSpan = new RecordedSpan();
    const rsStream = new ResultSet(
      Stream.Readable.from([{ text: () => line } satisfies ResultChunk], {
        objectMode: true,
      }),
      "JSONEachRow",
      "q2",
      undefined,
      undefined,
      undefined,
      streamSpan,
    );
    const streamed: unknown[] = [];
    for await (const batch of rsStream.stream()) {
      for (const row of batch) streamed.push(row.json());
    }
    expect(streamed).toEqual([{ s: "café 😀" }]);
    expect(streamSpan.attributes["clickhouse.response.decoded_bytes"]).toBe(
      expectedBytes,
    );

    // json() with text chunk (no rows fast path)
    const jsonSpan = new RecordedSpan();
    const rsJson = new ResultSet(
      Stream.Readable.from([{ text: () => line } satisfies ResultChunk], {
        objectMode: true,
      }),
      "JSONEachRow",
      "q3",
      undefined,
      undefined,
      undefined,
      jsonSpan,
    );
    expect(await rsJson.json()).toEqual([{ s: "café 😀" }]);
    expect(jsonSpan.attributes["clickhouse.response.decoded_bytes"]).toBe(
      expectedBytes,
    );
  });

  it("accounts for block bytes on the direct ResultChunk.rows() fast path", async () => {
    // Streamable JSONEachRow
    const spanEachRow = new RecordedSpan();
    const eachRowChunk: ResultChunk = {
      text: () => '{"n":1}\n{"n":2}\n',
      rows: () => ({ rows: [{ n: 1 }, { n: 2 }], text: "" }),
      bytes: 64,
    };
    const rsEachRow = new ResultSet(
      Stream.Readable.from([eachRowChunk], { objectMode: true }),
      "JSONEachRow",
      "q4",
      undefined,
      undefined,
      undefined,
      spanEachRow,
    );
    expect(await rsEachRow.json()).toEqual([{ n: 1 }, { n: 2 }]);
    expect(spanEachRow.attributes["clickhouse.response.decoded_bytes"]).toBe(
      64,
    );
    expect(spanEachRow.attributes["db.response.returned_rows"]).toBe(2);

    // Non-streamable JSON
    const spanJson = new RecordedSpan();
    const envelopeStart = '{"meta":[{"name":"n","type":"UInt8"}],"data":[';
    const envelopeEnd = '],"rows":0}';
    const jsonChunks: ResultChunk[] = [
      {
        text: () => envelopeStart + '{"n":1}',
        rows: () => ({ rows: [{ n: 1 }], text: envelopeStart }),
        bytes: 40,
      },
      { text: () => envelopeEnd },
    ];
    const rsJson = new ResultSet(
      Stream.Readable.from(jsonChunks, { objectMode: true }),
      "JSON",
      "q5",
      undefined,
      undefined,
      undefined,
      spanJson,
    );
    expect(await rsJson.json()).toEqual({
      meta: [{ name: "n", type: "UInt8" }],
      data: [{ n: 1 }],
      rows: 1,
    });
    expect(spanJson.attributes["clickhouse.response.decoded_bytes"]).toBe(
      Buffer.byteLength(envelopeStart + envelopeEnd) + 40,
    );
    expect(spanJson.attributes["db.response.returned_rows"]).toBe(1);
  });

  it("streams rows with rowCount hint and custom JSON parser", async () => {
    const chunk: ResultChunk = {
      text: () => '{"n":1}\n{"n":2}\n',
      rowCount: 2,
    };
    const rs = new ResultSet(
      Stream.Readable.from([chunk], { objectMode: true }),
      "JSONEachRow",
      "q6",
      undefined,
      undefined,
      {
        parse: <T>(text: string) =>
          ({ wrapped: JSON.parse(text) }) as unknown as T,
        stringify: JSON.stringify,
      },
    );
    const parsed: unknown[] = [];
    for await (const batch of rs.stream()) {
      for (const row of batch) parsed.push(row.json());
    }
    expect(parsed).toEqual([{ wrapped: { n: 1 } }, { wrapped: { n: 2 } }]);
  });

  it("pulls streamText sub-batches lazily and stops formatting on early close()", async () => {
    let calls = 0;
    const slices = [
      '{"n":1}\n{"n":2}\n',
      '{"n":3}\n{"n":4}\n',
      '{"n":5}\n{"n":6}\n',
      '{"n":7}\n{"n":8}\n',
      '{"n":9}\n',
    ];
    const chunk: ResultChunk = {
      text: () => slices.join(""),
      streamText: () => {
        let i = 0;
        return () => {
          calls++;
          return i < slices.length ? slices[i++] : undefined;
        };
      },
    };
    const rs = new ResultSet(
      Stream.Readable.from([chunk], { objectMode: true }),
      "JSONEachRow",
      "q7",
    );
    const seen: unknown[] = [];
    for await (const batch of rs.stream()) {
      for (const row of batch) seen.push(row.json());
      rs.close();
      break;
    }
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    // At most the first batch plus one read-ahead slice are formatted; the rest
    // of the block is skipped when ResultSet.close() runs.
    expect(calls).toBeLessThanOrEqual(2);
  });

  it("consumes all streamText sub-batches with accurate span metrics", async () => {
    const span = new RecordedSpan();
    const slices = ['{"n":1}\n{"n":2}\n', '{"n":3}\n'];
    const chunk: ResultChunk = {
      text: () => slices.join(""),
      streamText: () => {
        let i = 0;
        return () => (i < slices.length ? slices[i++] : undefined);
      },
    };
    const rs = new ResultSet(
      Stream.Readable.from([chunk], { objectMode: true }),
      "JSONEachRow",
      "q8",
      undefined,
      undefined,
      undefined,
      span,
    );
    const seen: unknown[] = [];
    for await (const batch of rs.stream()) {
      for (const row of batch) seen.push(row.json());
    }
    expect(seen).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    expect(span.attributes["db.response.returned_rows"]).toBe(3);
    expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(
      Buffer.byteLength(slices.join("")),
    );
  });
});
