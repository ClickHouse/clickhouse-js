import { describe, it, expect } from "vitest";
import {
  buildMultipartBody,
  MAX_URL_BIND_PARAM_LENGTH,
  serializeQueryParamsForUrl,
} from "../../src/utils/multipart";

describe("buildMultipartBody", () => {
  const boundary = "----test-boundary";

  it("should build a multipart body with one part", () => {
    const result = buildMultipartBody({ query: "SELECT 1" }, boundary);

    expect(result).toMatchInlineSnapshot(`
      "------test-boundary
      Content-Disposition: form-data; name="query"

      SELECT 1
      ------test-boundary--
      "
    `);
  });

  it("should build a multipart body with multiple parts", () => {
    const result = buildMultipartBody(
      {
        query: "SELECT * FROM t WHERE a = {x:UInt32} AND b = {y:String}",
        param_x: "42",
        param_y: "test",
      },
      boundary,
    );

    expect(result).toMatchInlineSnapshot(`
      "------test-boundary
      Content-Disposition: form-data; name="query"

      SELECT * FROM t WHERE a = {x:UInt32} AND b = {y:String}
      ------test-boundary
      Content-Disposition: form-data; name="param_x"

      42
      ------test-boundary
      Content-Disposition: form-data; name="param_y"

      test
      ------test-boundary--
      "
    `);
  });

  it("should handle empty parts record", () => {
    const result = buildMultipartBody({}, boundary);

    expect(result).toMatchInlineSnapshot(`
      "------test-boundary--
      "
    `);
  });

  it("should return a string", () => {
    const result = buildMultipartBody({ query: "SELECT 1" }, boundary);
    expect(typeof result).toBe("string");
  });

  it("should reject part names with special characters", () => {
    expect(() => buildMultipartBody({ "bad name": "value" }, boundary)).toThrow(
      'Invalid multipart part name: "bad name"',
    );
  });

  it("should reject part names with quotes", () => {
    expect(() =>
      buildMultipartBody({ 'key"injection': "value" }, boundary),
    ).toThrow('Invalid multipart part name: "key"injection"');
  });

  it("should reject part names with newlines", () => {
    expect(() =>
      buildMultipartBody({ "key\r\ninjection": "value" }, boundary),
    ).toThrow(/Invalid multipart part name/);
  });

  it("should accept part names with underscores and digits", () => {
    const result = buildMultipartBody({ param_my_value_123: "ok" }, boundary);

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_my_value_123"\r\n`,
    );
  });

  it("should accept part names with hyphens and dots", () => {
    const result = buildMultipartBody({ "param_my-key.name": "ok" }, boundary);

    expect(result).toContain(
      `Content-Disposition: form-data; name="param_my-key.name"\r\n`,
    );
  });
});

describe("serializeQueryParamsForUrl", () => {
  it("should return empty entries for empty params", () => {
    expect(serializeQueryParamsForUrl({})).toEqual([]);
  });

  it("should serialize small params under the threshold", () => {
    expect(serializeQueryParamsForUrl({ id: "123", name: "abc" })).toEqual([
      ["param_id", "123"],
      ["param_name", "abc"],
    ]);
  });

  it("should return null for a single oversized param", () => {
    expect(
      serializeQueryParamsForUrl({
        big: "x".repeat(MAX_URL_BIND_PARAM_LENGTH + 1),
      }),
    ).toBeNull();
  });

  it("should return null for many individually small params whose total exceeds the threshold", () => {
    const params: Record<string, string> = {};
    for (let i = 0; i < 40; i++) {
      params[`p${i}`] = "v".repeat(200);
    }
    expect(serializeQueryParamsForUrl(params)).toBeNull();
  });

  it("should account for percent-encoding expansion", () => {
    // Raw length is under the budget, but each ampersand encodes to three characters (%26)
    expect(
      serializeQueryParamsForUrl({
        s: "&".repeat(Math.ceil(MAX_URL_BIND_PARAM_LENGTH / 2)),
      }),
    ).toBeNull();
  });

  it("should measure the formatted value of non-string params", () => {
    // A large array formats to a long bracketed list
    const ids = [...Array(2000).keys()];
    expect(serializeQueryParamsForUrl({ ids })).toBeNull();
    expect(serializeQueryParamsForUrl({ ids: [1, 2, 3] })).toEqual([
      ["param_ids", "[1,2,3]"],
    ]);
  });

  it("should stay just under and flip just over the threshold", () => {
    // "param_v=" prefix is 8 characters
    expect(
      serializeQueryParamsForUrl({
        v: "x".repeat(MAX_URL_BIND_PARAM_LENGTH - 8),
      }),
    ).toEqual([["param_v", "x".repeat(MAX_URL_BIND_PARAM_LENGTH - 8)]]);
    expect(
      serializeQueryParamsForUrl({
        v: "x".repeat(MAX_URL_BIND_PARAM_LENGTH - 7),
      }),
    ).toBeNull();
  });
});
