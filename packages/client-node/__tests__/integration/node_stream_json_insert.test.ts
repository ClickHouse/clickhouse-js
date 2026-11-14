import { type ClickHouseClient } from "@clickhouse/client-common";
import { it, beforeEach, afterEach, expect, describe } from "vitest";
import { createSimpleTable } from "@test/fixtures/simple_table";
import { assertJsonValues, jsonValues } from "@test/fixtures/test_data";
import { createTestClient } from "@test/utils/client";
import { guid } from "@test/utils/guid";
import { sleep } from "@test/utils/sleep";
import Stream from "stream";
import { makeObjectStream } from "../utils/stream";

let client: ClickHouseClient;
let tableName: string;

beforeEach(async () => {
  client = createTestClient();
  tableName = `insert_stream_json_${guid()}`;
  await createSimpleTable(client, tableName);
});
afterEach(async () => {
  await client.close();
});

it("does not throw if stream closes prematurely", async () => {
  const stream = new Stream.Readable({
    objectMode: true,
    read() {
      this.push(null); // close stream
    },
  });

  await expect(
    client.insert({
      table: tableName,
      values: stream,
    }),
  ).resolves.toBeDefined();
});

it("waits for stream of values to be closed", async () => {
  let closed = false;
  const stream = new Stream.Readable({
    objectMode: true,
    read() {
      setTimeout(() => {
        this.push([42, "hello", [0, 1]]);
        this.push([43, "world", [3, 4]]);
        this.push(null);
        closed = true;
      }, 100);
    },
  });

  expect(closed).toBe(false);
  await client.insert({
    table: tableName,
    values: stream,
  });
  expect(closed).toBe(true);
});

it("can insert multiple streams at once", async () => {
  const streams: Stream.Readable[] = Array(jsonValues.length);
  const insertStreamPromises = Promise.all(
    jsonValues.map((value, i) => {
      const stream = makeObjectStream();
      streams[i] = stream;
      stream.push(value);
      return client.insert({
        values: stream,
        format: "JSONEachRow",
        table: tableName,
      });
    }),
  );
  setTimeout(() => {
    streams.forEach((stream) => stream.push(null));
  }, 100);
  await insertStreamPromises;
  await assertJsonValues(client, tableName);
});

it("should throw in case of an invalid format of data", async () => {
  const stream = makeObjectStream();
  stream.push({ id: "baz", name: "foo", sku: "[0,1]" });
  stream.push(null);
  await expect(
    client.insert({
      table: tableName,
      values: stream,
      format: "JSONEachRow",
    }),
  ).rejects.toMatchObject({
    message: expect.stringContaining("Cannot parse input"),
  });
});

// These tests check the data that the server gets from a large object-mode
// stream. They do not check how the client splits the request body into
// chunks, because the server does not show the chunk boundaries.
describe("large object-mode streams", () => {
  // Enough data for many request body chunks of 64 KiB, but fewer rows than
  // one server insert block (max_insert_block_size). For this reason, an
  // insert that fails must leave no rows in the table.
  const rowCount = 50_000;

  // The id is a string, because the test client sets
  // output_format_json_quote_64bit_integers = 1.
  function makeRows(count: number, firstId = 0) {
    return Array.from({ length: count }, (_, i) => {
      const id = firstId + i;
      return {
        id: String(id),
        name: `name-${id}`,
        sku: [id % 256, (id + 1) % 256],
      };
    });
  }

  async function selectAll() {
    const rs = await client.query({
      query: `SELECT * FROM ${tableName} ORDER BY id ASC`,
      format: "JSONEachRow",
    });
    return rs.json();
  }

  async function countRows() {
    const rs = await client.query({
      query: `SELECT count() AS count FROM ${tableName}`,
      format: "JSONEachRow",
    });
    const [{ count }] = await rs.json<{ count: string }>();
    return Number(count);
  }

  it("inserts all rows", async () => {
    const rows = makeRows(rowCount);
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(rows),
      format: "JSONEachRow",
    });
    expect(await selectAll()).toEqual(rows);
  });

  it("inserts all rows with request compression", async () => {
    const compressionClient = createTestClient({
      compression: { request: true },
    });
    try {
      const rows = makeRows(rowCount);
      await compressionClient.insert({
        table: tableName,
        values: Stream.Readable.from(rows),
        format: "JSONEachRow",
      });
      expect(await selectAll()).toEqual(rows);
    } finally {
      await compressionClient.close();
    }
  });

  it("inserts rows with multi-byte characters", async () => {
    const rows = makeRows(rowCount).map((row) => ({
      ...row,
      name: `日本語テキスト😀-${row.id}`,
    }));
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(rows),
      format: "JSONEachRow",
    });
    expect(await selectAll()).toEqual(rows);
  });

  it("inserts rows that are larger than 64 KiB, between small rows", async () => {
    const rows = makeRows(40).map((row, i) =>
      i % 4 === 0
        ? { ...row, name: `${"x".repeat(100 * 1024)}-${row.id}` }
        : row,
    );
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(rows),
      format: "JSONEachRow",
    });
    expect(await selectAll()).toEqual(rows);
  });

  it("inserts all rows of a source that pauses between the rows", async () => {
    const rows = makeRows(5);
    async function* slowSource() {
      for (const row of rows) {
        await sleep(20);
        yield row;
      }
    }
    await client.insert({
      table: tableName,
      values: Stream.Readable.from(slowSource()),
      format: "JSONEachRow",
    });
    expect(await selectAll()).toEqual(rows);
  });

  it("inserts all rows of streams that wait for the same connection", async () => {
    const singleConnectionClient = createTestClient({
      max_open_connections: 1,
    });
    try {
      // The second and the third insert wait for the socket of the first one.
      const parts = [0, 1, 2].map((part) => makeRows(10_000, part * 10_000));
      await Promise.all(
        parts.map((rows) =>
          singleConnectionClient.insert({
            table: tableName,
            values: Stream.Readable.from(rows),
            format: "JSONEachRow",
          }),
        ),
      );
      expect(await selectAll()).toEqual(parts.flat());
    } finally {
      await singleConnectionClient.close();
    }
  });

  it("fails and inserts no rows when the source fails in the middle of the stream", async () => {
    const error = new Error("The source failed");
    const stream = makeObjectStream();
    const insertPromise = client.insert({
      table: tableName,
      values: stream,
      format: "JSONEachRow",
    });
    for (const row of makeRows(10_000)) {
      stream.push(row);
    }
    // Let the client send these rows before the next rows and the error.
    await sleep(100);
    for (const row of makeRows(10_000, 10_000)) {
      stream.push(row);
    }
    stream.destroy(error);

    await expect(insertPromise).rejects.toThrow("The source failed");
    expect(await countRows()).toBe(0);
  });

  it("fails and inserts no rows when the insert is aborted in the middle of the stream", async () => {
    const controller = new AbortController();
    // The stream does not end, so the request body is not complete.
    const stream = makeObjectStream();
    const insertPromise = client.insert({
      table: tableName,
      values: stream,
      format: "JSONEachRow",
      abort_signal: controller.signal,
    });
    for (const row of makeRows(10_000)) {
      stream.push(row);
    }
    // Let the client send these rows before the abort.
    await sleep(100);
    controller.abort();

    await expect(insertPromise).rejects.toThrow("The user aborted a request");
    expect(await countRows()).toBe(0);
  });
});
