# Pluggable Connection — design

> **Status**: minimal upstream hook implemented in this branch
> (`feat/pluggable-connection`).
> Tracking issue: [#865](https://github.com/ClickHouse/clickhouse-js/issues/865).
> Parallel Python proposal: [ClickHouse/clickhouse-connect#809](https://github.com/ClickHouse/clickhouse-connect/issues/809).
> chDB-side implementation: <https://github.com/chdb-io/chdb-node>
> (the `chdb/connection` subpath export).

## What this PR adds

A single, additive hook on the `@clickhouse/client` Node client:

```ts
createClient({
  connection: createChdbConnection({ path: ":memory:" }),
});
```

`NodeClickHouseClientConfigOptions.connection?: Connection<Stream.Readable>`
lets a caller plug an externally-built `Connection` into `createClient`
instead of letting the package build its default HTTP connection from
`tls` / `keep_alive` / `http_agent` / etc. options. The existing
`Connection<Stream>` interface is unchanged — the backend implements
that exact contract and gets dropped in.

When `connection` is omitted (the default), behavior is byte-identical
to today: the bundled HTTP factory is used.

Implementation is a 3-line wrap of `NodeConfigImpl`: when `connection`
is provided, spread `NodeConfigImpl` and override only its
`make_connection` factory to return the injected connection verbatim;
otherwise pass `NodeConfigImpl` through unchanged. No HTTP/HTTPS code
is touched.

## Why this shape

Two design pressures, in tension, drove it:

1. **chDB's reason for existing is in-process zero-copy I/O.** Hiding
   chdb behind a loopback HTTP server (or any wire-format boundary)
   erases that.
2. **`@clickhouse/client`'s public surface is intentionally slim.**
   Bolting a second client family onto it — one mirroring the entire
   public API for chdb — is a maintenance trap: every new public
   method, every parameter change, every streaming refactor would have
   to be applied twice.

The compromise:

- **One public client API** stays `createClient` from `@clickhouse/client`.
- **The Connection<Stream> interface** behind it is unchanged — we only
  made it injectable.
- **The backend implementation lives in the backend's repo.** chdb-node
  ships `ChdbConnection` from `chdb/connection`. All chdb-side data and
  logic (the in-process memory model, the `.chdb` extension namespace
  for chDB-specific escape hatches, the skip list of tests chdb does
  not support, the CI matrix that runs THIS suite against
  ChdbConnection) stays in chdb-node's repo. **This repo carries zero
  chdb code, zero chdb tests, zero chdb CI dependency.**

## Usage

```ts
import { createClient } from "@clickhouse/client";
import { createChdbConnection } from "chdb/connection";

const client = createClient({
  connection: createChdbConnection({ path: ":memory:" }),
});

// All downstream code is identical across connections.
const rs = await client.query({
  query: "SELECT * FROM numbers(5)",
  format: "JSONEachRow",
});
for await (const row of rs.stream()) {
  /* ... */
}
await client.insert({ table: "t", values: rows });
await client.close();
```

The `chdb/connection` subpath is exposed by chdb-node v3.1+; see its
README and design doc for the in-process memory model, the `.chdb`
extension namespace, and the streaming roadmap.

## Test parity — who runs what, where

This repo does **not** participate in chdb-vs-server test parity.
There are no chdb-specific markers, no chdb skip lists, no chdb test
runners here.

Parity is owned by the backend's repo. chdb-node maintains:

- A blacklist of integration tests that chdb does not support
  (in chdb-node's repo, as `tests/clickhouse-js/skip_list.json`).
- A CI workflow that clones `@clickhouse/client` at a configured
  ref, runs its integration suite with the chdb backend injected,
  and applies the local blacklist.

chdb-node tests against the **latest released version** of
`@clickhouse/client`. Only when `@clickhouse/client` cuts a new release
does chdb-node re-run its parity job and update its blacklist for any
newly-failing tests.

## Data-vs-code split

```
┌──────────────────────────────────────┐        ┌──────────────────────────────────────┐
│  @clickhouse/client (this repo)       │        │   chdb-node (and any future backend) │
│                                       │        │                                      │
│  • Connection<Stream> interface       │        │  • ChdbConnection implements          │
│    (unchanged)                        │        │    Connection<Readable>               │
│  • createClient({ connection })       │   ◄──  │  • chdb/connection subpath export     │
│    new public injection point         │        │  • tests/clickhouse-js/skip_list.json │
│                                       │        │    (chdb-owned blacklist)             │
│  ❌ zero chdb code                    │        │  • CI clones THIS repo and runs its   │
│  ❌ zero chdb tests                   │        │    suite with skip_list applied       │
│  ❌ zero chdb CI dependency           │        │                                       │
└──────────────────────────────────────┘        └──────────────────────────────────────┘
```

Adding a future backend (e.g. native TCP) repeats the same pattern in
the backend's own repo. No PR to this repo is needed.

## What this PR deliberately does NOT do

- **No chdb-specific code paths.** This repo stays backend-agnostic.
- **No dependency on `chdb`.** Not in any `package.json`.
- **No per-feature test markers.** Tests stay un-tagged. Backends own
  their own blacklists in their own repos.
- **No skip-profile loader.** The injection point is the only hook;
  what to skip is the backend's data, applied by the backend's
  runner.
- **No client-web changes.** chdb is N-API and can only run in Node /
  Bun / Deno; a future web-runtime backend repeats this pattern in
  `client-web` if one ever lands.
