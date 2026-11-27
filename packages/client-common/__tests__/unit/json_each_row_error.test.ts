import { describe, expect, it } from "vitest";
import { ClickHouseError } from "../../src";
import { createJSONEachRowErrorDetector } from "../../src/utils/stream";

describe.each(["JSONEachRow", "JSONStringsEachRow"])(
  "%s error envelopes",
  (format) => {
    const detect = createJSONEachRowErrorDetector(format)!;

    it("detects an error without preceding data", () => {
      const message =
        'Code: 395. DB::Exception: 日本語: "quoted"\nnext \\ line. (FUNCTION_THROW_IF_VALUE_IS_NON_ZERO)';
      const error = detect('{"exception": ' + JSON.stringify(message) + "}");
      expect(error).toBeInstanceOf(ClickHouseError);
      expect(error).toMatchObject({
        code: "395",
        message: '日本語: "quoted"\nnext \\ line.',
      });
    });

    it("reports a server message that has no known error code", () => {
      const error = detect('{"exception": "unrecognized server failure"}');
      expect(error).toBeInstanceOf(Error);
      expect(error?.message).toBe("unrecognized server failure");
    });

    it("decodes line separators and a large message", () => {
      const message = "first\u2028second\u2029" + "x".repeat(1_000_000);
      expect(
        detect('{"exception": ' + JSON.stringify(message) + "}")?.message,
      ).toBe(message);
    });

    it.each([
      '{"exception":"Code: 395. DB::Exception: data. (SOME_ERROR)"}',
      '{"exception": "message", "n": 1}',
      '{"exception": "message", "n": "1"}',
      '{"exception": "message", "exception": "second"}',
      '{"exception": {"nested": "message"}}',
      '{"exception": 395}',
      '{"exception": "invalid\\q"}',
      '{"exception": "unterminated}',
      '{"exception": "raw\nnewline"}',
    ])("leaves data or malformed envelopes unchanged: %j", (text) => {
      expect(detect(text)).toBeUndefined();
    });
  },
);
