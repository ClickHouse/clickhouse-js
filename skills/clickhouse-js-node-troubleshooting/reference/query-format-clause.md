# `query()` FORMAT Clause Errors (incl. trailing comments and `SHOW [ROW] POLICIES`)

> **Applies to:** all versions.

`client.query()` is for statements that return a result set (such as `SELECT`). It **always adds `FORMAT <format>`** to the `query` string (at the end, or before a trailing `SETTINGS` clause when `sql_lexer` is set), where `<format>` comes from the `format` option (default `JSON`). You should therefore **not** include a `FORMAT` clause in the `query` yourself.

```js
// What you write:
await client.query({ query: "SELECT 1", format: "JSONEachRow" });

// What the client actually sends:
// SELECT 1
// FORMAT JSONEachRow
```

## Duplicate `FORMAT` — syntax error

If the `query` string already contains a `FORMAT` clause, the client still appends another one, producing a duplicate `FORMAT` and a server-side syntax error. This is intended behavior.

```js
// ❌ Wrong — ends up as `... FORMAT CSV FORMAT JSON` → syntax error
await client.query({ query: "SELECT 1 FORMAT CSV" });

// ✓ Correct — let the client append FORMAT via the option
await client.query({ query: "SELECT 1", format: "CSV" });
```

If you genuinely need to write the full SQL yourself (including the `FORMAT` clause), or you're running a statement where the appended `FORMAT` suffix is not supported, use `client.exec()` instead of `client.query()`. Use `client.insert()` for data insertion and `client.command()` for DDLs.

## `Multi-statements are not allowed` with a trailing comment

The client removes trailing semicolons before appending `FORMAT`. By default, it only removes a `;` that is the very last character. When the query ends with a semicolon followed by a comment, the `;` stays, the appended `FORMAT` becomes a second statement, and the server rejects the query with `Syntax error (Multi-statements are not allowed)`.

```js
// ❌ Fails by default — sent as `SELECT 1; -- note` + `FORMAT JSON`
await client.query({ query: "SELECT 1; -- note" });
```

**Fix:** remove the semicolon from the query, or, from client version 1.25.0, pass the official ClickHouse SQL lexer, which removes it correctly:

```js
import * as lexer from "@clickhouse/lexer"; // npm install @clickhouse/lexer

const client = createClient({ sql_lexer: lexer });
// ✓ Works — sent as `SELECT 1 -- note` + `FORMAT JSON`
await client.query({ query: "SELECT 1; -- note" });
```

With `sql_lexer` set, `query()` also puts `FORMAT` **before** a trailing `SETTINGS` clause (`SELECT 1 FORMAT JSON SETTINGS max_threads = 1`), which some older servers require. See https://github.com/ClickHouse/clickhouse-js/blob/main/docs/howto/sql_lexer.md

## `SHOW [ROW] POLICIES` fails even with a format

Some statements are not parsed by the server with a trailing `FORMAT` clause, so the `FORMAT` suffix that `query()` always appends triggers a syntax error. The most common case is the **short** form of `SHOW POLICIES` / `SHOW ROW POLICIES` — at the server SQL parser level it does not accept the `FORMAT` suffix.

```js
// ❌ Fails — query() appends `FORMAT JSON`, which the short SHOW POLICIES syntax rejects
await client.query({ query: "SHOW POLICIES", format: "JSON" });
await client.query({ query: "SHOW ROW POLICIES", format: "JSON" });
```

**Fix:** use the full syntax `SHOW POLICIES ON *` (or `SHOW POLICIES ON db.table`), which the parser accepts together with the appended `FORMAT`:

```js
// ✓ Works — full syntax accepts the appended FORMAT clause
await client.query({ query: "SHOW POLICIES ON *", format: "JSON" });
```

Alternatively, run the short statement through `client.exec()`, where you control the full SQL and no `FORMAT` suffix is appended.

This behavior is easy to misdiagnose because the error looks like a generic syntax error rather than a client/format problem. See the upstream issue: https://github.com/ClickHouse/ClickHouse/issues/105899
