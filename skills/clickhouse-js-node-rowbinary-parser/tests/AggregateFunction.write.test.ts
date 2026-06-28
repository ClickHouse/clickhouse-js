import { describe, expect, it } from "vitest";
import { encode } from "./encode.js";
import { writeAggregateFunction } from "../src/aggregateFunction_writer.js";

describe("writeAggregateFunction", () => {
  it("throws — opaque, unframed state is not generically encodable", () =>
    expect(() => encode(writeAggregateFunction, undefined as never)).toThrow(
      /AggregateFunction is opaque/,
    ));
});
