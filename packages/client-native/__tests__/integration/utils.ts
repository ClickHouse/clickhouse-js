/** The native protocol URL of the test server (`docker compose up clickhouse`). */
export function nativeURL(): string {
  return process.env["CLICKHOUSE_NATIVE_URL"] || "tcp://localhost:9000";
}

/** The HTTP URL of the same server, to compare the results. */
export function httpURL(): string {
  return process.env["CLICKHOUSE_HTTP_URL"] || "http://localhost:8123";
}

export function uniqueName(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}
