import { describe, it, expect, vi } from "vitest";
import type { BaseClickHouseClientConfigOptions } from "@clickhouse/client-common";
import { createClient } from "../../src";
import { isAwaitUsingStatementSupported } from "../utils/feature_detection";
import { sleep } from "../utils/sleep";
import { createSimpleWebTestClient } from "../utils/simple_web_client";

describe("[Web] createClient", () => {
  it("createSimpleWebTestClient creates a client without requiring ClickHouse", async () => {
    // Imported from the side-effect-free `simple_web_client` module, so it does
    // not register the shared `beforeAll` test-env init and needs no ClickHouse.
    const client = createSimpleWebTestClient();
    expect(client).toBeDefined();
    await client.close();
  });

  it('throws on incorrect "url" config value', () => {
    expect(() => createClient({ url: "foo" })).toThrow(
      expect.objectContaining({
        message: expect.stringContaining("ClickHouse URL is malformed."),
      }),
    );
  });

  it("throws on a zstd request codec (Node-only)", () => {
    expect(() =>
      createClient({ compression: { request: { codec: "zstd" } } }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          "zstd request compression is not supported by @clickhouse/client-web",
        ),
      }),
    );
  });

  it("throws on a zstd response codec (Node-only)", () => {
    expect(() =>
      createClient({ compression: { response: { codec: "zstd" } } }),
    ).toThrow(
      expect.objectContaining({
        message: expect.stringContaining(
          "zstd response compression is not supported by @clickhouse/client-web",
        ),
      }),
    );
  });

  it("allows the gzip codec", () => {
    const client = createClient({
      compression: { request: { codec: "gzip" }, response: { codec: "gzip" } },
    });
    expect(client).toBeDefined();
  });

  it("should not mutate provided configuration", async () => {
    const config: BaseClickHouseClientConfigOptions = {
      url: "https://localhost:8443",
    };
    createClient(config);
    // initial configuration is not overridden by the defaults we assign
    // when we transform the specified config object to the connection params
    expect(config).toEqual({
      url: "https://localhost:8443",
    });
  });

  it("closes the client when used with using statement", async ({ skip }) => {
    if (!isAwaitUsingStatementSupported()) {
      skip("using statement is not supported in this environment");
      return;
    }
    const client = createClient();
    let isClosed = false;
    vi.spyOn(client, "close").mockImplementation(async () => {
      // Simulate some delay in closing
      await sleep(0);
      isClosed = true;
    });

    // Wrap in eval to allow using statement syntax without
    // syntax error in older Node.js versions. Might want to
    // consider using a separate test file for this in the future.
    await eval(`
        (async (value) => {
            await using c = value;
            // do nothing, just testing the disposal at the end of the block
        })
      `)(client);

    expect(isClosed).toBeTruthy();
  });
});

describe("[Web] abort request", () => {
  it.each(["query", "command", "exec", "insert"] as const)(
    "does not send an already-aborted %s",
    async (method) => {
      const mockedFetch = vi.fn<typeof fetch>(async () => new Response(""));
      const client = createSimpleWebTestClient({ fetch: mockedFetch });
      const controller = new AbortController();
      controller.abort();
      const params = { abort_signal: controller.signal };
      try {
        const request =
          method === "insert"
            ? client.insert({
                table: "test",
                values: [{ x: 1 }],
                format: "JSONEachRow",
                ...params,
              })
            : client[method]({ query: "SELECT 1", ...params });
        await expect(request).rejects.toThrow("The user aborted a request.");
        expect(mockedFetch).not.toHaveBeenCalled();
      } finally {
        await client.close();
      }
    },
  );

  it.each([false, true])(
    "sends a request with a live signal: %s",
    async (withSignal) => {
      const mockedFetch = vi.fn<typeof fetch>(async () => new Response(""));
      const client = createSimpleWebTestClient({ fetch: mockedFetch });
      try {
        await client.command({
          query: "SELECT 1",
          abort_signal: withSignal ? new AbortController().signal : undefined,
        });
        expect(mockedFetch).toHaveBeenCalledOnce();
      } finally {
        await client.close();
      }
    },
  );

  it("still aborts a request after dispatch", async () => {
    const controller = new AbortController();
    const mockedFetch = vi.fn<typeof fetch>(async (_input, init) => {
      controller.abort();
      expect(init?.signal?.aborted).toBe(true);
      throw init?.signal?.reason;
    });
    const client = createSimpleWebTestClient({ fetch: mockedFetch });
    try {
      await expect(
        client.command({ query: "SELECT 1", abort_signal: controller.signal }),
      ).rejects.toThrow("The user aborted a request.");
      expect(mockedFetch).toHaveBeenCalledOnce();
    } finally {
      await client.close();
    }
  });
});
