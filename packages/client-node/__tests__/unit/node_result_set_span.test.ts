import { describe, expect, it } from "vitest";
import type {
  ClickHouseSpan,
  ClickHouseSpanAttributes,
  ClickHouseSpanStatus,
} from "@clickhouse/client-common";
import Stream, { Readable } from "stream";
import { ResultSet } from "../../src";

class RecordedSpan implements ClickHouseSpan {
  attributes: ClickHouseSpanAttributes = {};
  status?: ClickHouseSpanStatus;
  exception?: Error;
  endedTimes = 0;

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
    this.endedTimes++;
  }
}

describe("[Node.js] ResultSet span tracking", () => {
  const expectedText = `{"foo":"bar"}\n{"qaz":"qux"}\n`;

  function makeResultSet(span: RecordedSpan, stream?: Stream.Readable) {
    return new ResultSet(
      stream ?? Readable.from([Buffer.from(expectedText)]),
      "JSONEachRow",
      "query-id",
      undefined,
      undefined,
      undefined,
      span,
    );
  }

  it("ends the span and records decoded bytes after text()", async () => {
    const span = new RecordedSpan();
    const rs = makeResultSet(span);
    await rs.text();
    expect(span.endedTimes).toBe(1);
    expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(
      expectedText.length,
    );
    // No rows were counted on the text() path.
    expect(span.attributes["db.response.returned_rows"]).toBeUndefined();
    expect(span.status).toBeUndefined();
  });

  it("ends the span and records rows + bytes after json()", async () => {
    const span = new RecordedSpan();
    const rs = makeResultSet(span);
    expect(await rs.json()).toEqual([{ foo: "bar" }, { qaz: "qux" }]);
    expect(span.endedTimes).toBe(1);
    expect(span.attributes["db.response.returned_rows"]).toBe(2);
    expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(
      expectedText.length,
    );
    expect(span.status).toBeUndefined();
  });

  it("ends the span and records rows + bytes after the stream is fully consumed", async () => {
    const span = new RecordedSpan();
    const rs = makeResultSet(span);
    let rows = 0;
    for await (const batch of rs.stream()) {
      rows += batch.length;
    }
    expect(rows).toBe(2);
    expect(span.endedTimes).toBe(1);
    expect(span.attributes["db.response.returned_rows"]).toBe(2);
    expect(span.attributes["clickhouse.response.decoded_bytes"]).toBe(
      expectedText.length,
    );
  });

  it("ends the span without an error when the ResultSet is closed", async () => {
    const span = new RecordedSpan();
    const stream = Readable.from([Buffer.from(expectedText)]);
    // Swallow the synthetic "ResultSet has been closed" destroy error.
    stream.on("error", () => {});
    const rs = makeResultSet(span, stream);
    rs.close();
    expect(span.endedTimes).toBe(1);
    expect(span.status).toBeUndefined();
    expect(span.exception).toBeUndefined();
  });

  it("records a streaming error on the span and ends it exactly once", async () => {
    const span = new RecordedSpan();
    const failure = new Error("stream failed");
    const stream = new Readable({
      read() {
        this.destroy(failure);
      },
    });
    const rs = makeResultSet(span, stream);
    await expect(rs.text()).rejects.toThrow("stream failed");
    expect(span.endedTimes).toBe(1);
    expect(span.exception).toBe(failure);
    expect(span.attributes["error.type"]).toBe("Error");
    expect(span.status?.code).toBe(2); // ERROR
  });
});
