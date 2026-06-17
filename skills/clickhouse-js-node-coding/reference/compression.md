# Compression

> **Applies to:** all versions support boolean `compression`. The explicit
> codec object form (`{ codec: "gzip" | "zstd" }`) and `zstd` support are a
> Node-only addition; see the CHANGELOG for the exact release.

The client can compress the outgoing request (insert) body and ask the server
to compress the response (read) body. Both are configured under `compression`
on `createClient`.

## Answer checklist

When answering compression questions, include the relevant points:

- The option shape is `boolean | { codec }`, **not** a bare string. `true`
  means gzip (backwards compatible); `{ codec: "zstd" }` selects zstd. There is
  no `compression: { request: "zstd" }` shorthand — it must be
  `{ request: { codec: "zstd" } }`.
- `zstd` is **Node-only** (`@clickhouse/client`) and requires **Node.js >=
  22.15.0** (the built-in `zlib` zstd APIs). On `@clickhouse/client-web` or an
  older Node runtime, requesting `zstd` throws a clear error at `createClient`.
- Response compression cannot be enabled for a `readonly=1` user — the server
  rejects the required `enable_http_compression` setting change.
- Prefer `zstd` for write-heavy (insert) workloads: a similar-or-better ratio
  than gzip at materially lower CPU, and ClickHouse decompresses gzip
  single-threaded.

## gzip (default, all versions)

```ts
import { createClient } from "@clickhouse/client";

const client = createClient({
  compression: {
    request: true, // compress insert bodies with gzip
    response: true, // ask the server for a gzip-compressed response
  },
});
```

`request: true` / `response: true` are equivalent to
`{ codec: "gzip" }`.

## zstd (Node.js >= 22.15.0)

```ts
const client = createClient({
  compression: {
    request: { codec: "zstd" },
    response: { codec: "zstd" },
  },
});
```

You can mix codecs and directions, e.g. zstd inserts with uncompressed reads:

```ts
const client = createClient({
  compression: {
    request: { codec: "zstd" },
    // response omitted → uncompressed reads
  },
});
```

## Common pitfalls

- **`compression: { request: "zstd" }` is a type error.** Use the object form:
  `{ request: { codec: "zstd" } }`.
- **`zstd` on the web client throws.** `@clickhouse/client-web` does not
  compress request bodies, and zstd response handling depends on the browser;
  the web client rejects the `zstd` codec at `createClient`. Use Node, or gzip.
- **`zstd` on Node < 22.15 throws at client creation**, not deep inside a later
  insert/query. The error names the running Node version and tells you to use
  gzip instead.
- **Response compression + `readonly=1` user fails.** Response decompression
  needs `enable_http_compression=1`, which a readonly user cannot set.
