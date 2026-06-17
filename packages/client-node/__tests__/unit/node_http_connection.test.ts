import { describe, it, expect, vi } from "vitest";
import Http from "http";
import { ClickHouseLogLevel, LogWriter } from "@clickhouse/client-common";
import { TestLogger } from "../../../client-common/__tests__/utils/test_logger";
import type { NodeConnectionParams } from "../../src/connection";
import { NodeHttpConnection } from "../../src/connection";

/** Extends NodeHttpConnection to expose protected methods for testing. */
class TestableHttpConnection extends NodeHttpConnection {
  public testCreateClientRequest(
    ...args: Parameters<NodeHttpConnection["createClientRequest"]>
  ): Http.ClientRequest {
    return this.createClientRequest(...args);
  }
}

function buildHttpConnectionParams(
  overrides?: Partial<NodeConnectionParams>,
): NodeConnectionParams {
  return {
    url: new URL("http://localhost:8123"),
    request_timeout: 30_000,
    compression: {
      decompress_response: undefined,
      compress_request: undefined,
    },
    max_open_connections: 10,
    auth: { username: "default", password: "", type: "Credentials" },
    database: "default",
    clickhouse_settings: {},
    log_writer: new LogWriter(
      new TestLogger(),
      "HttpConnectionTest",
      ClickHouseLogLevel.OFF,
    ),
    log_level: ClickHouseLogLevel.OFF,
    keep_alive: {
      enabled: true,
      idle_socket_ttl: 2500,
    },
    set_basic_auth_header: true,
    capture_enhanced_stack_trace: false,
    eagerly_destroy_stale_sockets: false,
    ...overrides,
  };
}

describe("[Node.js] NodeHttpConnection", () => {
  describe("createClientRequest", () => {
    it("should forward max_response_headers_size as maxHeaderSize when set", () => {
      const mockRequest = {} as Http.ClientRequest;
      const httpRequestSpy = vi
        .spyOn(Http, "request")
        .mockReturnValue(mockRequest);

      const connection = new TestableHttpConnection(
        buildHttpConnectionParams({
          max_response_headers_size: 64 * 1024,
        }),
      );

      const url = new URL("http://localhost:8123/?query_id=test");
      const abortController = new AbortController();
      connection.testCreateClientRequest({
        method: "GET",
        url,
        headers: {},
        abort_signal: abortController.signal,
        query: "SELECT 1",
        query_id: "test-query-id",
        log_writer: new LogWriter(
          new TestLogger(),
          "HttpConnectionTest",
          ClickHouseLogLevel.OFF,
        ),
        log_level: ClickHouseLogLevel.OFF,
      });

      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      const calledOptions = httpRequestSpy.mock
        .calls[0][1] as Http.RequestOptions;
      expect(calledOptions.maxHeaderSize).toBe(64 * 1024);

      httpRequestSpy.mockRestore();
    });

    it("should not include maxHeaderSize when max_response_headers_size is undefined", () => {
      const mockRequest = {} as Http.ClientRequest;
      const httpRequestSpy = vi
        .spyOn(Http, "request")
        .mockReturnValue(mockRequest);

      const connection = new TestableHttpConnection(
        buildHttpConnectionParams(),
      );

      const url = new URL("http://localhost:8123/?query_id=test");
      const abortController = new AbortController();
      connection.testCreateClientRequest({
        method: "GET",
        url,
        headers: {},
        abort_signal: abortController.signal,
        query: "SELECT 1",
        query_id: "test-query-id",
        log_writer: new LogWriter(
          new TestLogger(),
          "HttpConnectionTest",
          ClickHouseLogLevel.OFF,
        ),
        log_level: ClickHouseLogLevel.OFF,
      });

      expect(httpRequestSpy).toHaveBeenCalledTimes(1);
      const calledOptions = httpRequestSpy.mock
        .calls[0][1] as Http.RequestOptions;
      expect(calledOptions).not.toHaveProperty("maxHeaderSize");

      httpRequestSpy.mockRestore();
    });
  });
});
