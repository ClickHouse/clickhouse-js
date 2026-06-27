import { describe, expect, it } from "vitest";
import { Sink } from "../src/core.js";
import { writeNothing } from "../src/nothing.js";
import { writeArray } from "../src/composite.js";
import { writeNullable } from "../src/composite.js";

describe("writeNothing", () => {
  it("throws if ever invoked directly", () => {
    const sink = new Sink();
    expect(() => writeNothing(sink, undefined as never)).toThrow(
      /Nothing is zero-width/,
    );
  });

  it("is never invoked for an empty Array(Nothing)", () => {
    const sink = new Sink();
    writeArray(writeNothing)(sink, []);
    // Just the varint length 0x00, the element writer never runs.
    expect(Buffer.from(sink.bytes())).toEqual(Buffer.from([0x00]));
  });

  it("is never invoked for a NULL Nullable(Nothing)", () => {
    const sink = new Sink();
    writeNullable(writeNothing)(sink, null);
    // Just the NULL flag byte 0x01, the inner writer never runs.
    expect(Buffer.from(sink.bytes())).toEqual(Buffer.from([0x01]));
  });
});
