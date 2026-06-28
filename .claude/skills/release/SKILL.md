---
name: release
description: >
  Drive a package release of `ClickHouse/clickhouse-js` end to end: bump the
  version, sync the protected `release` branch from `main`, watch the npm
  publish (which is gated by a manual approval on the `npm-publish` environment),
  and create the GitHub Release from the CHANGELOG. Use this skill whenever the
  task is to "release", "cut a release", "publish a new version", or "ship" one
  of the packages: `@clickhouse/client` (Node.js), `@clickhouse/client-web`
  (Web), `@clickhouse/client-common` (deprecated, rarely released), the
  standalone `@clickhouse/datatype-parser` (the type parser, under
  `packages/datatype-parser`), or `@clickhouse/rowbinary` (the RowBinary parser
  skill/package, under `skills/clickhouse-js-node-rowbinary-parser`). The agent
  drives the GitHub Actions workflows (`gh workflow run`), watches CI, pauses at
  the human-judgment points (PR review, the approval gate, GitHub Release text),
  and hands the deployment-approval link back to the human. Do NOT use this for
  fixing a failing release PR — that is the `fix-release-pr` skill.
---

# Releasing a `clickhouse-js` package

This skill is the source of truth for the release process. It supersedes the old
`RELEASING.md` (which now just points here).

## Before you start — read this

1. **Releases are per package.** There is no "release everything" button. Ask the
   user **which package(s)** they want to release and confirm — the packages are
   versioned independently and ship on independent cadences:
   - `@clickhouse/client` — Node.js client (`packages/client-node`)
   - `@clickhouse/client-web` — Web client (`packages/client-web`)
   - `@clickhouse/client-common` — **deprecated**, effectively frozen; only cut a
     final standalone release if explicitly asked.
   - `@clickhouse/datatype-parser` — standalone type parser (`packages/datatype-parser`)
   - `@clickhouse/rowbinary` — standalone RowBinary parser skill/package
     (`skills/clickhouse-js-node-rowbinary-parser`)

   The flow forks into two families — **workspace client packages** (client /
   client-web / client-common) and **standalone packages** (datatype-parser /
   rowbinary) — which differ in version bumping and publish workflow. Pick the
   right section below.

2. **`release` is a long-lived, protected branch.** It is _not_ a per-release
   branch. The `npm-publish` GitHub Actions environment only permits the
   `release` branch to deploy, and it additionally **requires a manual approval**
   before any publish job runs. You will hand the human an approval link and wait.

3. **You drive, the human judges.** Run the workflows with `gh`, watch CI, and
   pause at: (a) reviewing the release PR, (b) the `npm-publish` approval gate,
   (c) the GitHub Release text. Never push to `release` directly — if the release
   PR needs fixes, route them through `main` (see the `fix-release-pr` skill).

> ⚠️ **Known coupling (TODO: decouple per package).** The automatic `head` publish
> in `publish.yml` is **all-or-nothing**: any push to `release` that touches
> `packages/**` re-publishes a `head` build of **all three** client packages
> (client, client-web, client-common), even if you only bumped one. The manual
> `latest` publish _is_ per-package. The standalone packages
> (`datatype-parser`, `rowbinary`) are fully independent. This coupling should be
> reworked so each client package publishes independently — flag it if it gets in
> the way, but do not try to fix it as part of a release.

---

## Part A — Workspace client packages (`@clickhouse/client`, `-web`, `-common`)

### Step 1 — Verify the package CHANGELOG on `main`

Each package now keeps its **own** `CHANGELOG.md` (the repo-wide root
`CHANGELOG.md` is frozen). The package you're releasing maps to:

- `@clickhouse/client` → `packages/client-node/CHANGELOG.md`
- `@clickhouse/client-web` → `packages/client-web/CHANGELOG.md`
- `@clickhouse/client-common` → `packages/client-common/CHANGELOG.md`

These are normally updated **inside feature PRs** as they merge to `main`, under
a top `# <version>` header. A common mistake: the in-progress entries sit under
the wrong header — e.g. still under the **previously released** version, or under
a version that doesn't match the one you're about to cut. (Note: shared/common
code is bundled into both clients, so such changes should appear in both the
client-node and client-web changelogs.)

- Compute the version this release will produce: current version + the
  `bump_type` you'll pick. Current version:
  ```bash
  node -p "require('./packages/client-node/package.json').version"   # or client-web / client-common
  ```
- Confirm that package's `CHANGELOG.md` has a top `# <new-version>` section that
  actually contains this release's notes.
- If it's wrong, **fix it in a small separate PR to `main` and merge it quickly**
  before bumping — do not bundle the changelog fix into the bump PR.

### Step 2 — Bump the version (opens a PR to `main`)

Dispatch the `bump-version` workflow. It bumps the selected package's
`package.json` + `src/version.ts` and opens a `release-<pkg>-<ver>` PR **against
`main`**:

```bash
gh workflow run bump-version.yml --ref main \
  -f package='@clickhouse/client' \
  -f bump_type=patch        # patch | minor | major
```

Find and watch the resulting PR, get it reviewed, and **merge it into `main`**:

```bash
gh run list --workflow=bump-version.yml --limit 1
gh pr list --search 'head:release-client-' --state open   # locate the bump PR
```

### Step 3 — Sync `release` from `main` (the "release PR")

Open a **real PR with base `release`, head `main`**. This PR is the snapshot
that gets reviewed once more _as a whole_ (code-review tooling runs on the full
diff):

```bash
gh pr create --base release --head main \
  --title "<version> release" \
  --body "Sync release from main to cut <package> <version>."
```

- If review surfaces issues, **do not push to `release`**. Fix on `main` via a
  separate PR (use the `fix-release-pr` skill), then the release PR picks the fix
  up automatically. Keep `release` and `main` from drifting.
- When it's clean, **merge the release PR**.

### Step 4 — Watch the automatic `head` publish + e2e

Merging into `release` pushes to `release`, which triggers `publish.yml` to
publish a `head` pre-release build (an **internal beta — not tracked** as a
GitHub Release) of the client packages, followed by an automatic `e2e` job that
installs the published version across Node 20/22/24/26 and runs integration
tests against a live ClickHouse.

- This publish runs under the `npm-publish` environment → **it pauses for manual
  approval**. Find the run, give the human the approval link, and wait:
  ```bash
  gh run list --workflow=publish.yml --branch release --limit 3
  gh run view <run-id> --json url -q .url      # hand this URL to the human to approve
  gh run watch <run-id>                        # waits for completion
  ```
- The `e2e` job in `publish.yml` is sufficient verification — **no manual `@head`
  testing is needed**. Just watch it.
- **If e2e fails:** the broken build is already on npm under the `head` tag.
  Suggest moving that tag out of the way so nobody installs it, e.g.:
  ```bash
  npm dist-tag add @clickhouse/client@<broken-version> debugging
  ```
  Then fix forward on `main` and re-sync `release`.

### Step 5 — Publish to `latest` (manual dispatch, per package)

Once the `head` e2e is green, dispatch `publish.yml` **manually, per package**,
from the `release` branch. This builds, publishes to the `latest` tag (npm OIDC +
provenance), and pushes a git tag (`client-<ver>`, `client-web-<ver>`, or
`client-common-<ver>`):

```bash
gh workflow run publish.yml --ref release -f package='@clickhouse/client'
```

This also runs under `npm-publish` → **approval gate again**. Same drill: hand
over the approval URL, then watch:

```bash
gh run list --workflow=publish.yml --branch release --event workflow_dispatch --limit 1
gh run view <run-id> --json url -q .url
gh run watch <run-id>
```

Repeat for each package being released (e.g. dispatch again with
`-f package='@clickhouse/client-web'`).

For the deprecated `@clickhouse/client-common`, if you ever cut one, also confirm
its npm deprecation notice is in place (it should already be).

### Step 6 — Create the GitHub Release

The auto-published `head` betas are **not** tracked as Releases. The `latest`
release **is**. Create a GitHub Release from the matching section of **that
package's** `CHANGELOG.md` (e.g. `packages/client-node/CHANGELOG.md` for
`@clickhouse/client`).

- The tag was pushed by the publish workflow: `client-<ver>` / `client-web-<ver>`
  / `client-common-<ver>` (note: client tags have **no** `v` prefix).
- Use the CHANGELOG section that documents this release as the body. Extract it
  (the lines under `# <version>` up to the next `# ` header):
  ```bash
  awk -v v="1.23.0" '$0=="# "v{f=1;next} /^# /{f=0} f' \
    packages/client-node/CHANGELOG.md > /tmp/notes.md
  ```
- **Do not pass `--title`** — GitHub renders the title from the tag itself. These
  are not pre-releases, so do not pass `--prerelease`:
  ```bash
  gh release create client-1.23.0 --notes-file /tmp/notes.md
  ```
- **Backfill check:** sometimes earlier releases are missing their GitHub Release.
  Compare pushed tags against existing releases and create any that are missing,
  pulling each one's notes from the matching CHANGELOG section:
  ```bash
  gh release list --limit 50
  git ls-remote --tags origin | grep -oE 'client(-web|-common)?-[0-9.]+'
  ```

---

## Part B — Standalone packages (`@clickhouse/datatype-parser`, `@clickhouse/rowbinary`)

These ship independently. **There is no `bump-version` workflow and no `head`
beta** for them.

### Step 1 — Bump the version manually on `main`

Edit the version in the package's `package.json` (these have **no** `src/version.ts`):

- `@clickhouse/datatype-parser` → `packages/datatype-parser/package.json`
- `@clickhouse/rowbinary` → `skills/clickhouse-js-node-rowbinary-parser/package.json`

Do this in a normal PR to `main`, together with the relevant entry in **that
package's own** `CHANGELOG.md` (verify the changelog as in Part A, Step 1):

- `@clickhouse/datatype-parser` → `packages/datatype-parser/CHANGELOG.md`
- `@clickhouse/rowbinary` → `skills/clickhouse-js-node-rowbinary-parser/CHANGELOG.md`

Merge it.

### Step 2 — Sync `release` from `main`

Same as Part A, Step 3: open a `base release ← head main` PR, get it reviewed as
a whole, merge it. (Pushing to `release` does **not** auto-publish these
standalone packages — only the client packages have an auto `head` publish.)

### Step 3 — Publish to `latest` (manual dispatch, no inputs)

Dispatch the package's own publish workflow from the `release` branch. These take
**no inputs**; the `release`-branch ref is required by the workflow's `if` guard:

```bash
# type parser:
gh workflow run publish-datatype-parser.yml --ref release
# rowbinary parser skill/package:
gh workflow run publish-skill-rowbinary-parser.yml --ref release
```

Each workflow builds, packs + smoke-tests the tarball, publishes it to `latest`
(OIDC + provenance), pushes a git tag (`datatype-parser-v<ver>` /
`rowbinary-v<ver>` — note the **`v`** prefix here), then runs the `e2e` job
across Node 20/22/24/26.

Same `npm-publish` **approval gate** applies — hand over the approval URL and
watch:

```bash
gh run list --workflow=publish-datatype-parser.yml --branch release --limit 1
gh run view <run-id> --json url -q .url
gh run watch <run-id>
```

### Step 4 — Create the GitHub Release

Same as Part A, Step 6, using the standalone tag (`datatype-parser-v<ver>` /
`rowbinary-v<ver>`) and the notes from that package's own `CHANGELOG.md`
(`packages/datatype-parser/CHANGELOG.md` or
`skills/clickhouse-js-node-rowbinary-parser/CHANGELOG.md`). No `--title`, no
`--prerelease`. Backfill any missing releases.

---

## Quick reference

**Client packages:**

1. Verify/fix the top section of the package's own `CHANGELOG.md` (e.g. `packages/client-node/CHANGELOG.md`) on `main` (quick PR if wrong).
2. `gh workflow run bump-version.yml --ref main -f package=… -f bump_type=…` → review & merge the bump PR to `main`.
3. `gh pr create --base release --head main` → review the whole release PR → merge.
4. Auto `head` publish + e2e on push to `release` → **approve** at `npm-publish`, watch e2e. (If e2e fails: retag the bad build to `debugging`, fix forward.)
5. `gh workflow run publish.yml --ref release -f package=…` per package → **approve**, watch.
6. `gh release create <client-…-tag> --notes-file <changelog-section>` (no `--title`, not prerelease); backfill missing releases.

**Standalone packages (datatype-parser / rowbinary):**

1. Bump version in the package's `package.json` + its own `CHANGELOG.md` via a PR to `main` → merge.
2. `gh pr create --base release --head main` → review → merge.
3. `gh workflow run publish-datatype-parser.yml --ref release` (or `publish-skill-rowbinary-parser.yml`) → **approve**, watch.
4. `gh release create <…-v…-tag> --notes-file <changelog-section>`; backfill.

**Always:** per package · each package has its **own** `CHANGELOG.md` (root is frozen) · `release` is protected (fix via `main`) · every publish needs `npm-publish` approval · `head` betas are untracked · GitHub Release notes come from the package's `CHANGELOG.md` with no explicit `--title`.
