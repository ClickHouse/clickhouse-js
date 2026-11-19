import { describe, expect, it } from "vitest";
import Stream from "stream";
import { drainStream } from "../../src";

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
