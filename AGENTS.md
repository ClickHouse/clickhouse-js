# Recommendations for AI agents

1. When adding log messages, make sure to use eager log level checks to avoid unnecessary calculations for log messages that will not be emitted. For example:

   ```ts
   if (log_level <= ClickHouseLogLevel.WARN) {
     log_writer.warn({
       message: 'Example log message',
     })
   }
   ```

2. When adding new log messages with suggestions for users, make sure to create a unique documentation page in the `docs` directory with a detailed explanation of the issue and how to resolve it. Then, include a link to that documentation page in the log message. For example:

   ```ts
   if (some_condition) {
     log_writer.warn({
       message:
         'Example log message with suggestions for users. For more information, see https://github.com/ClickHouse/clickhouse-js/blob/main/docs/example-log-message.md',
     })
   }
   ```

## Examples

The repository contains an [`examples`](examples) directory that is being refactored to be AI-agent-friendly.
The goals of the refactor are:

1. Examples should be runnable right away, with no manual edits required to get them working against a
   local ClickHouse instance (use `docker-compose up` from the repo root for the default setup).
2. Examples are organized by client flavor and tailored to the corresponding runtime:
   - [`examples/node`](examples/node) — examples for the Node.js client (`@clickhouse/client`). These
     may freely use Node.js-only APIs (file streams, TLS, `http`, `node:*` built-ins, etc.) and import
     Node built-ins using the `node:` prefix (e.g., `node:fs`, `node:path`, `node:stream`).
   - [`examples/web`](examples/web) — examples for the Web client (`@clickhouse/client-web`). These
     must only use Web-platform APIs (e.g., `globalThis.crypto.randomUUID()` instead of Node's
     `crypto` module) and must not depend on Node.js-only modules.
3. `examples/node` and `examples/web` are independent npm packages, each with its own `package.json`,
   `tsconfig.json`, and ESLint config. Keep dependencies and configuration scoped to the relevant
   subpackage.
4. General-purpose scenarios (configuration, ping, inserts, selects, parameters, sessions, etc.) should
   exist in both subdirectories where applicable, with the only differences being the `import`
   statement and any platform-specific adjustments. Examples that rely on Node.js-only APIs live only
   under `examples/node`.
## When reviewing code changes

For every pull request review, make sure to provide an evaluation of the following aspects:

### Security implications

1. This repository is a client library for ClickHouse, which is a database management system. When reviewing code changes, it is important to consider the security implications of the changes. For example, if the code changes involve handling user input or interacting with external systems, it is important to ensure that the code is secure and does not introduce vulnerabilities such as SQL injection or cross-site scripting (XSS).

2. Additionally, when reviewing code changes, it is important to consider the potential impact on data privacy and compliance with relevant regulations such as GDPR or CCPA. For example, if the code changes involve handling personally identifiable information (PII), it is important to ensure that the code is designed to protect user privacy and comply with relevant regulations.

### API quality and stability

1. When reviewing code changes, it is important to consider the impact on the API quality and stability. For example, if the code changes involve modifying the library's public API surface (such as exported functions, classes, or types) or adding new public APIs, it is important to ensure that the changes are well-documented and do not break existing functionality for users of the library.

2. When introducing new features or making changes to the API make sure to update the CHANGELOG.md file with a concise description of the changes followed with an example usage if applicable.

3. Additionally, make sure that the official documentation is in sync with the changes. The MCP server for the documentation is running at `https://clickhouse.mcp.kapa.ai/`.
