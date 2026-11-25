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

`client-node` and `client-web` are slated to be **separated into fully independent packages**. Because
of that, some logic is **intentionally duplicated** between the two connection implementations
(`client-node/src/connection/node_base_connection.ts` and
`client-web/src/connection/web_connection.ts`) rather than hoisted into `client-common` — for
example the per-request `use_multipart_params` resolution and the `param_*` multipart-part assembly
loop. **Do not flag this node/web duplication as something to consolidate**, and prefer keeping each
client self-contained over adding shared helpers that only exist to remove the duplication. Genuinely
platform-agnostic primitives (like `buildMultipartBody`) still belong in `client-common`.
