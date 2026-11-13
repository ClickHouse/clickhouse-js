// @ts-nocheck
import { createClient } from "@clickhouse/client-node";
import { undiciTransport } from "@clickhouse/client-node/undici/index";

/**
 * This file is used to set up the test environment for Vitest when running tests in Node.js.
 *
 * Set `CLICKHOUSE_TEST_TRANSPORT=undici` to run the test suite with the
 * optional undici transport (`@clickhouse/client/undici`) instead of the
 * built-in `node:http` / `node:https` transport. The test clients that set
 * their own `http_agent`, `transport` or `connection` keep their configuration.
 */
const transport = process.env.CLICKHOUSE_TEST_TRANSPORT || "http";
if (transport !== "http" && transport !== "undici") {
  throw new Error(
    `Unsupported CLICKHOUSE_TEST_TRANSPORT: [${transport}]. Supported values are: http, undici.`,
  );
}

globalThis.environmentSpecificCreateClient =
  transport === "undici"
    ? (config = {}) =>
        createClient(
          config.http_agent !== undefined ||
            config.transport !== undefined ||
            config.connection !== undefined
            ? config
            : { ...config, transport: undiciTransport() },
        )
    : createClient;
