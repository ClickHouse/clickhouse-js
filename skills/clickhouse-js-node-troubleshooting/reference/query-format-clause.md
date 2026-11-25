# `query()` and the `FORMAT` Clause

> **Applies to:** `@clickhouse/client` and `@clickhouse/client-web` 1.25.0+. For older versions, see [Older versions](#older-versions) below.

`client.query()` is for statements that return a result set (such as `SELECT`). It sends the `query` string **as written**, and passes the `format` option (default `JSON`) to the server as the `default_format` setting. The client does not change your SQL, so trailing semicolons, comments and `SETTINGS` clauses all work.

```js
// What you write:
await client.query({ query: "SELECT 1; -- note", format: "JSONEachRow" });

// What the client sends: the SQL as written, plus `default_format=JSONEachRow`
// in the request URL.
```

## Don't add a `FORMAT` clause to the query

If the `query` string has its own `FORMAT` clause, the server uses it instead of `default_format`, so the response may not be in the format the `format` option says. The client compares the format the server responded in (the `X-ClickHouse-Format` header) with the `format` option and throws when they differ:

```js
// ❌ Wrong — throws: "The server responded in the CSV format, but the JSON format was requested ..."
await client.query({ query: "SELECT 1 FORMAT CSV" });

// ✓ Correct — pass the format via the option
await client.query({ query: "SELECT 1", format: "CSV" });
```

A `FORMAT` clause that matches the `format` option is accepted, but it is redundant: prefer the option.

The same goes for an `X-ClickHouse-Format` request header: the server prefers it over `default_format`, so `client.query()` does not send one, even when it is set in `http_headers` (on the client or on the call). The other methods send it as given.

If you genuinely need to write the full SQL yourself, including the `FORMAT` clause, use `client.exec()` instead of `client.query()`. Use `client.insert()` for data insertion and `client.command()` for DDLs.

## Older versions

Before 1.25.0, `query()` appends `\nFORMAT <format>` to the end of the query instead. That causes these errors, all fixed by upgrading:

- **A duplicate `FORMAT`** is a syntax error when the query has its own `FORMAT` clause.
- **`Syntax error (Multi-statements are not allowed)`** when the query ends with a semicolon followed by a comment, such as `SELECT 1; -- note`. The `;` is kept, so the appended `FORMAT` becomes a second statement. Workaround: remove the semicolon.
- **The short `SHOW POLICIES` / `SHOW ROW POLICIES`** fails, because the server parser does not accept a `FORMAT` suffix there ([ClickHouse#105899](https://github.com/ClickHouse/ClickHouse/issues/105899)). Workaround: use the full syntax `SHOW POLICIES ON *`, or `client.exec()`.
- **A trailing `SETTINGS` clause** gets `FORMAT` appended after it, which some older ClickHouse server versions reject.
