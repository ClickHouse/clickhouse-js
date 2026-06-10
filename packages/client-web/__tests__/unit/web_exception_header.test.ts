import { describe, it, expect } from "vitest";
import { ClickHouseError } from "@clickhouse/client-common";
import { createSimpleWebTestClient } from "../utils/simple_web_client";

// ClickHouse can respond with HTTP 200 but still report an exception via the
// `X-ClickHouse-Exception-Code` header (e.g., when an error occurs while the
// response is being streamed). See https://github.com/ClickHouse/ClickHouse/pull/8786
describe("[Web] 200 response with X-ClickHouse-Exception-Code header", () => {
  const errorMessage =
    "Code: 395. DB::Exception: Value passed to 'throwIf' function is non-zero: " +
    "while executing 'FUNCTION throwIf(equals(number, 3) :: 1) -> throwIf(equals(number, 3))'. " +
    "(FUNCTION_THROW_IF_VALUE_IS_NON_ZERO) (version 24.3.1)";

  function createClientWithMockedFetch() {
    const mockedFetch: typeof fetch = async () =>
      new Response(errorMessage, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=UTF-8",
          "X-ClickHouse-Exception-Code": "395",
        },
      });
    return createSimpleWebTestClient({
      url: "http://localhost:8123",
      fetch: mockedFetch,
    });
  }

  it("should reject a query with a parsed ClickHouseError", async () => {
    const client = createClientWithMockedFetch();
    await expect(
      client.query({ query: "SELECT throwIf(number = 3) FROM numbers(10)" }),
    ).rejects.toEqual(
      expect.objectContaining({
        code: "395",
        type: "FUNCTION_THROW_IF_VALUE_IS_NON_ZERO",
        message: expect.stringContaining(
          "Value passed to 'throwIf' function is non-zero",
        ),
      }),
    );
    await client.close();
  });

  it("should reject with a ClickHouseError instance", async () => {
    const client = createClientWithMockedFetch();
    await expect(client.query({ query: "SELECT 1" })).rejects.toBeInstanceOf(
      ClickHouseError,
    );
    await client.close();
  });

  it("should reject insert/command/exec as well", async () => {
    const client = createClientWithMockedFetch();
    await expect(
      client.insert({
        table: "test",
        values: [{ x: 1 }],
        format: "JSONEachRow",
      }),
    ).rejects.toBeInstanceOf(ClickHouseError);
    await expect(
      client.command({ query: "OPTIMIZE TABLE test" }),
    ).rejects.toBeInstanceOf(ClickHouseError);
    await expect(client.exec({ query: "SELECT 1" })).rejects.toBeInstanceOf(
      ClickHouseError,
    );
    await client.close();
  });
});
