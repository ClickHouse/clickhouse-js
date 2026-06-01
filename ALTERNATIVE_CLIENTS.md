# Building specialized clients for alternative runtimes and protocols

This document is for third-party developers who want to build a ClickHouse
client for a runtime or protocol that is not officially covered by this
repository — for example a [Bun](https://bun.sh)-native client, a
[Cloudflare Workers](https://workers.cloudflare.com/) client, a client that
speaks the native ClickHouse TCP protocol, a gRPC-over-proxy client, etc.

We want to make this as easy as possible and encourage you to reuse the code
that already lives in this repo.

## Start a conversation first

Before you write a lot of code, please:

1. Open a [GitHub issue](https://github.com/ClickHouse/clickhouse-js/issues)
   describing the runtime/protocol you want to target and the high-level
   approach you have in mind.
2. Let us discuss the design with you. A short upfront conversation usually
   saves a lot of rework and makes the eventual PR much easier to review and
   merge.

## A note on `@clickhouse/client-common`

Historically, shared code between `@clickhouse/client` (Node.js) and
`@clickhouse/client-web` lived in a third published package,
`@clickhouse/client-common`, which both of them depended on.

That package is being **deprecated**. The motivation is to simplify versioning
across our packages and to avoid bundling/duplication issues that several
downstream users have hit.

What this means in practice:

- The shared code is **not** being moved into a new shared package; there is
  no replacement package to depend on.
- Instead, the shared code is being inlined / co-located inside each runtime
  package (`packages/client-node`, `packages/client-web`, …). Going forward
  each runtime package is self-contained.
- If you are building a new client, you should not try to depend on a shared
  package either — copy the pieces you need into your own package, the same
  way `client-node` and `client-web` do.

We know this means a bit more duplication, but it makes each package easier
to publish, version, and bundle independently — which is especially valuable
for alternative-runtime clients.

## Recommended workflow

The fastest way to bootstrap a new client is to **fork an existing package
in-tree and iterate on it**:

1. Pick whichever of the existing packages is closest to what you want to
   build:
   - `packages/client-node` — good starting point for server-side runtimes
     (Bun, Deno with Node compat, native protocol over TCP sockets, etc.).
   - `packages/client-web` — good starting point for browser-like / fetch-only
     runtimes (Cloudflare Workers, Vercel Edge, Deno Deploy, browser
     extensions, etc.).
2. Edit that package in place until you have something working end-to-end for
   your target runtime/protocol. Run the existing tests against it, adjust
   them as needed, and prove the approach out.
3. Once it works, **rename the package directory** to something descriptive,
   for example `packages/my-native-client` or `packages/client-bun`, update
   its `package.json` `name` field accordingly, and open a PR.

### Please keep the git history

When you rename and submit your package, **do not squash or rewrite the
commits** that show how it diverged from `client-node` / `client-web`. Keep
the original "copy" commit and your incremental changes on top. This makes it
much easier for reviewers (and future contributors) to see exactly what had
to change relative to the upstream package and why — which is invaluable when
keeping the new client in sync with future fixes to the existing clients.

A typical PR history might look like:

```
chore: copy client-web to packages/client-bun
feat(client-bun): replace fetch with Bun.fetch primitives
fix(client-bun): adapt streaming to Bun's ReadableStream
test(client-bun): port web integration tests
```

## Checklist before opening the PR

- [ ] There is an issue / discussion describing the motivation and design.
- [ ] The new package lives under `packages/<your-client>` and has its own
      `package.json` with a unique `name`.
- [ ] No dependency on `@clickhouse/client-common` (it is deprecated).
- [ ] Commit history shows the diff against the package you forked from.
- [ ] Tests for the new runtime/protocol are included where practical.
- [ ] Build, lint, and tests pass via the repo's standard scripts.

Thanks for contributing — we're excited to see ClickHouse reach more
runtimes and protocols!
