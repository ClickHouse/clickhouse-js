# Release process

Tools required (for verifying a published build and promoting npm tags locally):

- Node.js >= `20.x`
- npm >= `11.x` — newer than the npm bundled with Node.js `20.x`/`22.x` (`10.x`). Either upgrade npm in place (`npm install -g npm@latest`) or use Node.js `24.x`, which already ships npm `11.x`.

Packages are versioned and released independently. Release one package at a time; to release several, repeat the steps below for each. Versions are bumped through the GitHub Actions workflows — there is no local version-bump script.

## Bump the version

Run the [`bump-version`](.github/workflows/bump-version.yml) workflow from the GitHub Actions tab. Select:

- `package` — the package to release: `@clickhouse/client`, `@clickhouse/client-web`, or `@clickhouse/client-common` (the last is deprecated, but can still be cut a final standalone release).
- `bump_type` — `patch`, `minor`, or `major`.

The workflow computes the next version, bumps that package's `package.json` and `src/version.ts`, and opens a release PR against `main`.

Review and merge the PR into `main`.

## Publish the `head` build

The signed `head` build is published by the [`publish`](.github/workflows/publish.yml) workflow on push to the long-lived `release` branch — not on merge to `main`. After the bump PR is merged, update `release` from `main` (open a PR from `main` into `release` and merge it). That push triggers the `head` publish for every package.

## Test the `head` build

After the package is published it can be tested in a separate project by installing it with the `head` tag:

```bash
npm install @clickhouse/client@head
```

and run a simple e2e test: https://github.com/ClickHouse/clickhouse-js/actions/workflows/npm.yml

## Promote the `head` tag to `latest`

Run this for the package(s) you released:

```bash
npm dist-tag add @clickhouse/client@head latest
npm dist-tag add @clickhouse/client-web@head latest
npm dist-tag add @clickhouse/client-common@head latest
```

Mark the deprecated `@clickhouse/client-common` package as such on npm (it is no longer used by `@clickhouse/client` or `@clickhouse/client-web`; the shared code is bundled into each client package):

```bash
npm deprecate @clickhouse/client-common "This package is deprecated and no longer used by @clickhouse/client or @clickhouse/client-web. Import everything from @clickhouse/client (Node.js) or @clickhouse/client-web (Web) instead."
```

Check that the packages have been published correctly: <https://www.npmjs.com/org/clickhouse>

Then create a new release in GitHub for the published version and include the corresponding changelog notes.

All done, thanks!
