---
name: setup
description: >
  Set up the `clickhouse-js` repository in a fresh checkout so the agent can run
  tests, lints, type checks, builds, or examples. Use this skill before invoking
  any `npm run test:*`, `npm run lint`, `npm run typecheck`, `npm run build`, or
  `npm run run-examples` script — or after pulling changes that touch any
  `package.json` (root, `examples/node`, or `examples/web`). Covers Node.js
  version requirements, installing dependencies across the npm workspaces and
  the two independent example packages, building the workspace packages so
  inter-package imports resolve, and starting ClickHouse via Docker Compose for
  integration tests. Do NOT use this skill for downstream user projects that
  merely depend on `@clickhouse/client` or `@clickhouse/client-web`; it is
  specific to contributing to the `ClickHouse/clickhouse-js` repo itself.
---

# clickhouse-js Repository Setup

Use this skill before running any of the `npm run test:*`, `npm run lint`, `npm run typecheck`, or `npm run build` scripts in a fresh checkout (or after pulling changes that touch `package.json` files).

## Prerequisites

- **Node.js 22 recommended** (matches `.nvmrc`). The root `package.json` declares `"engines": { "node": ">=20" }`, and CI tests Node 20, 22, and 24.
- **Docker** with the Compose plugin (`docker compose ...`). Required only for integration tests and any example that talks to a real server.

## 1. Install dependencies

This is an npm workspaces repo (`packages/*`), with two additional independent example packages (`examples/node`, `examples/web`) that have their own `package.json` and are **not** part of the workspaces.

Install all three:

```bash
npm install
npm --prefix examples/node install
npm --prefix examples/web install
```

The root `postinstall` script patches `node_modules/parquet-wasm/package.json`; it runs automatically as part of `npm install`.

## 2. Build the workspace packages

The workspace packages (`@clickhouse/client-common`, `@clickhouse/client`, `@clickhouse/client-web`) must be built before some tests, examples, and typechecks can resolve their inter-package imports:

```bash
npm run build
```

This runs `build` in every workspace package.

## 3. Start ClickHouse (only for integration tests / examples)

Unit tests do **not** need a server. Integration tests (`npm run test:*:integration*`) and the example runners do.

From the repo root:

```bash
docker compose up -d
```

This starts both the single-node setup (`clickhouse` on 8123/9000, `clickhouse_tls` on 8443/9440) and the two-node cluster (`clickhouse1`, `clickhouse2`, plus the `nginx` round-robin entrypoint on 8127). All services use non-overlapping ports so a single `up -d` covers every integration test mode.

To override the server version, set `CLICKHOUSE_VERSION` when starting Compose; for example: `CLICKHOUSE_VERSION=head docker compose up -d`, `CLICKHOUSE_VERSION=latest docker compose up -d`, or `CLICKHOUSE_VERSION=24.8 docker compose up -d` to use an explicit version tag.

## 4. Verify

After the steps above you can run, for example:

- `npm run lint` — lint every workspace package
- `npm run typecheck` — typecheck every workspace package
- `npm run test:node:unit` / `npm run test:web:unit` — unit tests, no server required
- `npm run test:node:integration` / `npm run test:web:integration` — integration tests, server required
- From `examples/node` or `examples/web`: `npm run lint`, `npm run typecheck`, `npm run run-examples`

See `npm run` from the repo root for the full list of test scripts.
