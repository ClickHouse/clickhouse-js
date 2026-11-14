import { describe, it, expect } from "vitest";
import Stream from "stream";
import { mapStream } from "../../src/utils/stream";

/** Collects the output of a stream. Resolves when the stream ends. */
function collect(stream: Stream.Readable): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    stream.on("data", (chunk: string) => chunks.push(chunk));
    stream.once("end", () => resolve(chunks));
    stream.once("error", reject);
  });
}

/** Resolves after the event loop ran the callbacks that were due before now. */
function nextEventLoopTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function toRow(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

describe("[Node.js] mapStream", () => {
  it("should send the rows of one tick as one chunk", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ x: i }));
    const stream = mapStream(toRow);
    const result = collect(stream);
    for (const row of rows) {
      stream.write(row);
    }
    // The end of the stream sends the rows that are still in the buffer.
    stream.end();
    const chunks = await result;
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(rows.map(toRow).join(""));
  });

  it("should send a batch when it reaches 64 KiB", async () => {
    const row = "x".repeat(1023); // 1 KiB with the newline
    const stream = mapStream((value) => `${value}\n`);
    const result = collect(stream);
    for (let i = 0; i < 100; i++) {
      stream.write(row);
    }
    stream.end();
    const chunks = await result;
    expect(chunks.map((chunk) => chunk.length)).toEqual([
      64 * 1024, // 64 rows, sent when the buffer reached the limit
      36 * 1024, // 36 rows, sent at the end of the stream
    ]);
    expect(chunks.join("")).toBe(`${row}\n`.repeat(100));
  });

  it("should not keep the rows of a slow source until the stream ends", async () => {
    const stream = mapStream(toRow);
    const chunks: string[] = [];
    stream.on("data", (chunk: string) => chunks.push(chunk));

    stream.write({ x: 1 });
    await nextEventLoopTurn();
    await nextEventLoopTurn();
    expect(chunks).toEqual(['{"x":1}\n']);

    // Two rows of one tick are one chunk.
    stream.write({ x: 2 });
    stream.write({ x: 3 });
    await nextEventLoopTurn();
    await nextEventLoopTurn();
    expect(chunks).toEqual(['{"x":1}\n', '{"x":2}\n{"x":3}\n']);

    const ended = new Promise((resolve) => stream.once("end", resolve));
    stream.end();
    await ended;
    expect(chunks).toHaveLength(2);
  });

  it("should keep the backpressure of a slow consumer", async () => {
    // Nobody reads the output of the stream, so the consumer is stalled.
    // Each turn of the event loop gets one row, so rows do not make a batch.
    const stream = mapStream(toRow);
    let accepted = 0;
    while (accepted < 1000 && stream.write({ x: accepted })) {
      accepted++;
      await nextEventLoopTurn();
    }
    // The stream must tell the source to stop. It must not keep all the rows.
    expect(accepted).toBeLessThan(100);
    stream.destroy();
  });

  it("should fail when the source fails with rows in the batch", async () => {
    const error = new Error("source failed");
    const source = new Stream.Readable({ objectMode: true, read() {} });
    const stream = mapStream(toRow);
    const chunks: string[] = [];
    const sink = new Stream.Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const result = Stream.promises.pipeline(source, stream, sink);
    source.push({ x: 1 });
    source.push({ x: 2 });
    source.destroy(error);
    await expect(result).rejects.toBe(error);
    await nextEventLoopTurn();
    expect(stream.destroyed).toBe(true);
    // The rows in the batch are dropped, not sent after the failure.
    expect(chunks).toEqual([]);
  });

  it("should fail when a row cannot be encoded, with rows in the batch", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const source = new Stream.Readable({ objectMode: true, read() {} });
    const stream = mapStream(toRow);
    const chunks: string[] = [];
    const sink = new Stream.Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(chunk.toString());
        callback();
      },
    });
    const result = Stream.promises.pipeline(source, stream, sink);
    source.push({ x: 1 });
    source.push(circular);
    source.push({ x: 2 });
    await expect(result).rejects.toThrow(TypeError);
    await nextEventLoopTurn();
    expect(stream.destroyed).toBe(true);
    // The rows in the batch are dropped, not sent after the failure.
    expect(chunks).toEqual([]);
  });

  it("should not send the batch after the stream is destroyed", async () => {
    const stream = mapStream(toRow);
    const chunks: string[] = [];
    stream.on("data", (chunk: string) => chunks.push(chunk));
    stream.write({ x: 1 });
    stream.write({ x: 2 });
    // An aborted insert destroys the stream while the rows wait in the batch.
    stream.destroy();
    await nextEventLoopTurn();
    await nextEventLoopTurn();
    expect(chunks).toEqual([]);
  });
});
