# Recommendations for AI agents — `packages/`

Guidance for the client source packages. See the [repo-root `AGENTS.md`](../AGENTS.md) for cross-cutting guidance (code intelligence, code-review expectations, changelog rules).

## Log messages

1. When adding log messages, make sure to use eager log level checks to avoid unnecessary calculations for log messages that will not be emitted. For example:

   ```ts
   if (log_level <= ClickHouseLogLevel.WARN) {
     log_writer.warn({
       message: "Example log message",
     });
   }
   ```

2. When adding new log messages with suggestions for users, make sure to create a unique documentation page under the [`docs/`](../docs) directory (use `docs/howto/` for task-style guides; see `docs/socket_hang_up_econnreset.md` as a reference) with a detailed explanation of the issue and how to resolve it. Then, include a link to that documentation page in the log message. For example:

   ```ts
   if (some_condition) {
     log_writer.warn({
       message:
         "Example log message with suggestions for users. For more information, see https://github.com/ClickHouse/clickhouse-js/blob/main/docs/socket_hang_up_econnreset.md",
     });
   }
   ```

## Package structure and code duplication

The source packages here are:

- `client-common` — platform-agnostic shared code (config, query-param formatting, multipart
  assembly, URL handling, result sets, etc.). It must not depend on Node.js-only or Web-only APIs.
  The published `@clickhouse/client-common` package is **deprecated**: `client-node` and `client-web`
  no longer depend on it and instead bundle its sources via the `src/common` symlink
  (`client-node/src/common` and `client-web/src/common` both point to
  `client-common/src`), importing from it with relative paths (e.g. `./common/index`).
- `client-node` (`@clickhouse/client`) — the Node.js client.
- `client-web` (`@clickhouse/client-web`) — the Web/edge client.
- `client-native` (`@clickhouse/client-native`, experimental) — a Node.js client over the native TCP
  protocol. It also bundles the common sources through its `src/common` symlink, and copies the
  result set from `client-node`. The server sends `Native` blocks: the package decodes them
  (`src/protocol/`) and writes the rows in the requested text format (`src/formats.ts`), so the
  result set and the public API are the same as in `client-node`. The integration tests compare
  every result with the result of the HTTP client.

`client-node` and `client-web` are slated to be **separated into fully independent packages**, and
`client-native` is likewise kept self-contained. Because of that, some logic is **intentionally
duplicated** across the client packages rather than hoisted into `client-common` — for example the
per-request `use_multipart_params` resolution and `param_*` multipart-part assembly loop in
`client-node/src/connection/node_base_connection.ts` and `client-web/src/connection/web_connection.ts`,
or the Node.js `ResultSet`, `client.ts`, `utils/encoder.ts`, and `src/index.ts` re-export surface
between `client-node` and `client-native`. **Do not flag this cross-client duplication as something
to consolidate**, and prefer keeping each client self-contained over adding shared helpers that only
exist to remove the duplication. Genuinely platform-agnostic primitives (like `buildMultipartBody`)
still belong in `client-common`.

## Keeping `client-node` and `client-native` in sync

`@clickhouse/client-native` mirrors the Node.js public API of `@clickhouse/client` over the native
TCP protocol (`tcp://` / `tcps://`). When modifying `packages/client-common` or `packages/client-node`,
check whether `packages/client-native` needs a matching change:

1. **Public exports & types (`src/index.ts`, `src/client.ts`):** When adding, renaming, or deprecating
   an export or re-export from `./common/index` in `packages/client-node/src/index.ts`, mirror it in
   `packages/client-native/src/index.ts` unless the symbol is strictly HTTP-only.
2. **`ResultSet` & Node stream / encoder utilities (`src/result_set.ts`, `src/utils/`):**
   `client-native/src/result_set.ts` is adapted from `client-node/src/result_set.ts` (adding the
   decoded `ResultChunk` fast path for `json()`). Bug fixes to Node stream consumption, mid-stream
   error handling, `close()`, custom `json.parse` / `json.stringify` (`NodeValuesEncoder`), or
   tracing span accounting (`db.response.returned_rows`, `clickhouse.response.uncompressed_bytes`)
   usually apply to both packages.
3. **Configuration & URL parsing (`src/config.ts`):** New general or Node.js-relevant client options
   (timeouts, TLS, `application`, `clickhouse_settings`, logging, tracing) should be handled in
   `client-native/src/config.ts` as well; HTTP-only options (`keep_alive`, `http_headers`,
   `http_agent`, `set_basic_auth_header`, `pathname`) are intentionally ignored or omitted on TCP.
4. **Formats, data types & query parameters:** `client-native` decodes `Native` blocks
   (`src/protocol/`) and formats text/JSON locally (`src/formats.ts`, `src/json_rows.ts`) to match
   ClickHouse's HTTP output byte-for-byte. When changing supported formats, type representations,
   SQL `FORMAT` / `SETTINGS` handling, or parameter binding, check `client-native` and run its
   HTTP-parity tests (`npm run test:native:unit` and `npm run test:native:integration`).
