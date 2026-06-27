import { describe, expect, it } from "vitest";
import { Sink } from "../src/core.js";
import { writeAggregateFunction } from "../src/aggregateFunction.js";

describe("writeAggregateFunction", () => {
  it("throws — opaque, unframed state is not generically encodable", () => {
    const sink = new Sink();
    expect(() => writeAggregateFunction(sink, undefined as never)).toThrow(
      /AggregateFunction is opaque/,
    );
  });
});
