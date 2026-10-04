# @clickhouse/client-common

> [!WARNING]
> **This package is deprecated and is no longer maintained as a dependency.**
> It is no longer used by [`@clickhouse/client`](https://www.npmjs.com/package/@clickhouse/client)
> (Node.js) or [`@clickhouse/client-web`](https://www.npmjs.com/package/@clickhouse/client-web)
> (Web), and there is **no replacement package** to depend on. Do not add this
> package to new projects.
>
> - Building a ClickHouse app on **Node.js**? Install
>   [`@clickhouse/client`](https://www.npmjs.com/package/@clickhouse/client).
> - Building for the **browser / edge runtimes**? Install
>   [`@clickhouse/client-web`](https://www.npmjs.com/package/@clickhouse/client-web).

## What this package was for

Historically, the shared code between `@clickhouse/client` (Node.js) and
`@clickhouse/client-web` lived in this third published package,
`@clickhouse/client-common`, which both of them depended on. It exposed the
shared types and the base framework that were also intended to be the foundation
for building **custom client implementations** for alternative runtimes (such as
Bun or Cloudflare Workers) or alternative protocols (such as the native
ClickHouse protocol or gRPC over a proxy).

## Why it is deprecated

The shared-package approach is being retired to simplify versioning across the
packages and to avoid the bundling/duplication issues that several downstream
users have hit.

What this means in practice:

- The shared code is **not** being moved into a new shared package; there is no
  replacement to depend on.
- Instead, the shared code is now inlined / co-located inside each runtime
  package (`@clickhouse/client`, `@clickhouse/client-web`, …). Going forward,
  each runtime package is **self-contained** and published independently.

## Building a client for an alternative runtime or protocol

The new, recommended approach is to **fork an existing in-tree client package and
iterate on it** — copy the pieces you need into your own package the same way
`client-node` and `client-web` do, rather than depending on a shared package.

See
[Building specialized clients for alternative runtimes and protocols](https://github.com/ClickHouse/clickhouse-js/blob/main/ALTERNATIVE_CLIENTS.md)
for the full guide.

## Changelog

See [`CHANGELOG.md`](https://github.com/ClickHouse/clickhouse-js/blob/main/packages/client-common/CHANGELOG.md).

## License

[Apache 2.0](https://github.com/ClickHouse/clickhouse-js/blob/main/LICENSE)
