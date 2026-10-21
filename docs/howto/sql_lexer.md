# Using the official ClickHouse SQL lexer

The client makes small changes to the SQL you pass it before sending it to the server. For example, it removes trailing semicolons, because the server rejects a statement followed by a `;` in some positions. By default, it does this with simple string handling, which can't tell whether a `;` is inside a comment, a string or a heredoc.

To make these changes exactly as the server would read your query, you can give the client the official ClickHouse SQL lexer, [`@clickhouse/lexer`](https://www.npmjs.com/package/@clickhouse/lexer). It is ClickHouse's own lexer compiled to WebAssembly: about 9 KB, with no dependencies of its own.

## Enabling it

Install the package next to the client:

```sh
npm install @clickhouse/lexer
```

Then pass the module to `createClient`:

```ts
import { createClient } from "@clickhouse/client"; // or '@clickhouse/client-web'
import * as lexer from "@clickhouse/lexer";

const client = createClient({
  sql_lexer: lexer,
});
```

The client never imports `@clickhouse/lexer` itself, so it stays optional, and your bundler only sees the import you write. The lexer is loaded the first time it's needed.

`sql_lexer` can't be set from the connection URL.

## What it changes

With `sql_lexer` set, `query()`, `command()` and `exec()` remove trailing semicolons using the lexer's tokens. A semicolon followed by a comment is removed, and the comment is kept:

| Query you pass             | Sent without the lexer     | Sent with the lexer       |
| -------------------------- | -------------------------- | ------------------------- |
| `CREATE TABLE t ...;`      | `CREATE TABLE t ...`       | `CREATE TABLE t ...`      |
| `CREATE TABLE t ...; -- x` | `CREATE TABLE t ...; -- x` | `CREATE TABLE t ... -- x` |
| `SELECT 1 -- note;`        | `SELECT 1 -- note`         | `SELECT 1 -- note;`       |

This matters most for `query()`, which appends `FORMAT <format>` after your query. Without the lexer, `SELECT 1; -- note` is sent as `SELECT 1; -- note` followed by `FORMAT JSON` on a new line. The server reads that as two statements and rejects it with `Multi-statements are not allowed`. With the lexer, the semicolon is removed first, so the query works.

When the query ends with a `SETTINGS` clause, `query()` also puts `FORMAT` before it instead of after it, because some server versions require `SETTINGS` to come last:

| Query you pass                      | Sent without the lexer                              | Sent with the lexer                             |
| ----------------------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `SELECT 1 SETTINGS max_threads = 1` | `SELECT 1 SETTINGS max_threads = 1` + `FORMAT JSON` | `SELECT 1 FORMAT JSON SETTINGS max_threads = 1` |

This only happens for a `SETTINGS` clause outside any brackets that runs to the end of the query. A `SETTINGS` clause in a subquery, or the word `settings` used as a name, is left alone.

If the lexer can't tokenize a query, for example because a quote is never closed, the client uses its built-in handling for that query and leaves the error for the server to report.

## "Failed to load the SQL lexer" warning

The lexer runs as WebAssembly, compiled at runtime from bytes embedded in the package. Some environments don't allow that:

- **Browsers with a Content Security Policy** that does not include `'wasm-unsafe-eval'` in `script-src`. Add `'wasm-unsafe-eval'` to allow it.
- **Runtimes that forbid compiling WebAssembly at runtime**, such as Cloudflare Workers.

When the lexer fails to load, the client logs this warning once and keeps working with its built-in handling. If you can't allow WebAssembly in your environment, remove the `sql_lexer` option to stop the warning.
