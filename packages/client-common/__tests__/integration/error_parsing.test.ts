import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client-common";
import { createTestClient, getTestDatabaseName } from "../utils";
import { randomUUID } from "@test/utils/guid";

describe("ClickHouse server errors parsing", () => {
  let client: ClickHouseClient;
  beforeEach(() => {
    client = createTestClient();
  });
  afterEach(async () => {
    await client.close();
  });

  it('returns "unknown identifier" error', async () => {
    // Possible error messages here:
    // (since 24.3+, Cloud SMT): Unknown expression identifier 'number' in scope SELECT number AS FR
    // (since 23.8+, Cloud RMT): Missing columns: 'number' while processing query: 'SELECT number AS FR', required columns: 'number'
    // (since 24.9+): Unknown expression identifier `number` in scope SELECT number AS FR
    // (since 26.10+): Unknown expression identifier `number`. In scope SELECT number AS FR: Note: ...
    const errorMessagePattern =
      `((?:Missing columns: 'number' while processing query: 'SELECT number AS FR', required columns: 'number')|` +
      `(?:Unknown expression identifier ('|\`)number('|\`)\\.? [Ii]n scope SELECT number AS FR))`;
    await expect(
      client.query({
        query: "SELECT number FR",
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringMatching(errorMessagePattern),
        code: "47",
        type: "UNKNOWN_IDENTIFIER",
      }),
    );
  });

  it('returns "unknown table" error', async () => {
    // Possible error messages here:
    // (since 24.3+, Cloud SMT): Unknown table expression identifier 'unknown_table' in scope
    // (since 23.8+, Cloud RMT): Table foo.unknown_table does not exist.
    // (since 26.10+): Unknown table expression identifier 'unknown_table'. In scope SELECT * FROM unknown_table.
    const dbName = getTestDatabaseName();
    const errorMessagePattern =
      `((?:^Table ${dbName}.unknown_table does not exist.*)|` +
      `(?:Unknown table expression identifier ('|\`)unknown_table('|\`)\\.? [Ii]n scope))`;
    await expect(
      client.query({
        query: "SELECT * FROM unknown_table",
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringMatching(errorMessagePattern),
        code: "60",
        type: "UNKNOWN_TABLE",
      }),
    );
  });

  it('returns "syntax error" error', async () => {
    await expect(
      client.query({
        query: "SELECT * FRON unknown_table",
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringContaining("Syntax error: failed at position"),
        code: "62",
        type: "SYNTAX_ERROR",
      }),
    );
  });

  it('returns "syntax error" error in a multiline query', async () => {
    await expect(
      client.query({
        query: `
        SELECT *
        /* This is:
         a multiline comment
        */
        FRON unknown_table
        `,
      }),
    ).rejects.toMatchObject(
      expect.objectContaining({
        message: expect.stringContaining("Syntax error: failed at position"),
        code: "62",
        type: "SYNTAX_ERROR",
      }),
    );
  });

  // The message of `throwIf` is user text, and it can look like the markers
  // that the parser uses to find the end of the server error.
  describe("a message with text that looks like a server marker", () => {
    it("keeps the message after a (TYPE) group with a version that is not the server's", async () => {
      await expect(
        client.query({
          query: "SELECT throwIf(1, 'see (FOO_BAR) (version 1) here')",
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /^see \(FOO_BAR\) \(version 1\) here: while executing .*\.$/,
        ),
        code: "395",
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      });
    });

    it("keeps the message after such a group with a session_id", async () => {
      await expect(
        client.query({
          query: "SELECT throwIf(1, 'see (FOO_BAR) (version 1) here')",
          session_id: randomUUID(),
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /^see \(FOO_BAR\) \(version 1\) here: while executing .*\.$/,
        ),
        code: "395",
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      });
    });

    it("keeps the message after a group with a version of fewer than four numbers", async () => {
      await expect(
        client.query({
          query: "SELECT throwIf(1, 'see (FOO_BAR) (version 1.2) here')",
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /^see \(FOO_BAR\) \(version 1\.2\) here: while executing .*\.$/,
        ),
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      });
    });

    // The server sends no stack trace when the message has `Stack trace` text.
    it("gives the real type with the stacktrace setting", async () => {
      await expect(
        client.query({
          query: "SELECT throwIf(1, 'x (ABC), Stack trace (y)')",
          clickhouse_settings: { stacktrace: 1 },
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /^x \(ABC\), Stack trace \(y\): while executing .*\.$/,
        ),
        code: "395",
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      });
    });

    it("gives the real type when the user text has the full stack trace sentence", async () => {
      await expect(
        client.query({
          query:
            "SELECT throwIf(1, 'x (ABC), Stack trace (when copying this message, always include the lines below): z')",
          clickhouse_settings: { stacktrace: 1 },
        }),
      ).rejects.toMatchObject({
        message: expect.stringMatching(
          /^x \(ABC\), Stack trace \(when .* z: while executing .*\.$/,
        ),
        code: "395",
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
      });
    });
  });

  // With the setting `stacktrace`, the server adds the stack after the type.
  // The message must not have the stack.
  it("leaves out a real stack trace of the server", async () => {
    await expect(
      client.query({
        query: "SELECT * FROM unknown_table_for_a_stack_trace",
        clickhouse_settings: { stacktrace: 1 },
      }),
    ).rejects.toMatchObject({
      message: expect.not.stringMatching(
        /Stack trace|DB::Exception::Exception/,
      ),
      code: "60",
      type: "UNKNOWN_TABLE",
    });
  });
});
