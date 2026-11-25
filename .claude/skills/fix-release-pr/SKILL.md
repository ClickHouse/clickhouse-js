---
name: fix-release-pr
description: >
  Fix CI failures and address code-review comments on a pull request that
  targets the protected `release` branch of `ClickHouse/clickhouse-js`. Release
  PRs are snapshots of `main` (their head branch is usually `main` itself) and
  cannot be edited directly — branch protection blocks pushing fixes onto them.
  Use this skill whenever the work is "fix the CI / address the review comments
  on PR #N" and that PR's base branch is `release`: it routes the fix through a
  separate PR to `main`, then closes the loop on the original release PR by
  replying to and resolving the review threads. Triggers on phrasing like "fix
  this release PR", "the release PR is failing CI", "address the review comments
  but it's a release branch", or after checking out a PR whose base is `release`.
  Do NOT use this for ordinary feature/fix PRs that target `main` — for those,
  just push to the PR's own branch.
---

# Fixing PRs to the `release` branch

## Why this skill exists

In `clickhouse-js`, the `release` branch receives **release PRs** — snapshots of
`main` opened to cut a version (e.g. titled "1.23 beta2"). Two properties make
them special:

- The PR's **head branch is usually `main` itself** (base `release`, head `main`).
  `gh pr checkout <N>` is therefore a no-op that leaves you on `main` — do **not**
  commit fixes there.
- `release` is **protected**: you cannot push commits onto the release PR to fix
  CI or review feedback.

So fixes never go onto the release PR. They go to **`main` via a separate PR**;
once that merges, the release branch is re-synced from `main` and the release PR
picks the fix up. This skill is that workflow.

## Step 1 — Confirm it's a release PR

```bash
gh pr view <N> --json title,baseRefName,headRefName,headRefOid
```

If `baseRefName` is `release`, proceed. (If it's `main`, this skill does not
apply — push to the PR's branch normally.)

## Step 2 — Gather what needs fixing

**CI failures.** List checks and find the `fail` rows:

```bash
gh pr checks <N>
```

- The job named **`success`** is an _aggregate gate_ ("Fail if any needed job
  failed") — it only fails _because_ a real job failed. Ignore it as a root cause
  and find the actual failing job.
- Open the real failure log:

```bash
gh run view --job <JOB_ID> --log-failed | tail -50
```

**Review comments.** Inline review comments with their REST IDs and the GraphQL
thread node IDs (you need both: REST `id` to reply, thread node `id` to resolve):

```bash
# Inline comments: REST id + location + author + body
gh api repos/ClickHouse/clickhouse-js/pulls/<N>/comments \
  -q '.[] | "\(.id)\t\(.path):\(.line)\t\(.user.login)\n\(.body)\n---"'

# Review threads: node id (PRRT_…), resolved state, and first comment's databaseId
gh api graphql -f query='
{ repository(owner:"ClickHouse", name:"clickhouse-js") {
    pullRequest(number: <N>) {
      reviewThreads(first: 50) { nodes {
        id isResolved
        comments(first: 1) { nodes { databaseId path body } }
      } }
    } } }' \
  -q '.data.repository.pullRequest.reviewThreads.nodes[]
      | "\(.id)\tresolved=\(.isResolved)\tdbId=\(.comments.nodes[0].databaseId)\t\(.comments.nodes[0].path)"'
```

Match each thread (`PRRT_…` node id) to its first comment's `databaseId` — that
`databaseId` is the REST comment id you reply to in Step 5.

## Step 3 — Branch off the latest `main`

Never branch off the release PR head. Start from up-to-date `main`:

```bash
git fetch origin
git checkout -b fix/<short-topic> origin/main
```

## Step 4 — Make the fix and verify

Apply the fixes. Then verify with the repo's own tooling (run the `setup` skill
first if `node_modules` isn't populated):

- **Prettier** is the most common release-PR CI failure. House style is the
  Prettier defaults (`.prettierrc` is `{}` → double quotes + semicolons).
  Fix and check:
  ```bash
  node_modules/.bin/prettier --write <file>
  npm run -s prettier:check
  ```
  `prettier:check` runs on the whole repo and may flag **untracked local scratch
  dirs** (e.g. a `type-parser/` working directory). Those aren't part of the PR
  and CI never sees them — only tracked files matter. Confirm no _tracked_ file
  is flagged:
  ```bash
  npm run -s prettier:check 2>&1 \
    | grep -oE '\[(warn|error)\] [^ ]+\.(mjs|ts|js|json|ya?ml|md)' \
    | grep -v '<your-untracked-dir>/' | sort -u   # empty = clean
  ```
- For standalone scripts: `node --check <file>`.
- For library code: `npm run typecheck`, `npm run lint`, and the relevant
  `npm run test:*` target (see the `setup` skill for what each needs).
- When the fix is logic (not just formatting), exercise it directly — e.g. drive
  the script against synthetic inputs in the scratchpad dir and assert the
  exit code / output, rather than trusting it by inspection.

## Step 5 — Commit, push, open the PR to `main`

```bash
git commit -m "<type>(<scope>): <summary>

Addresses CI failure / review feedback on #<N> (release PR). The fix lands
on \`main\` separately because #<N> targets the protected \`release\` branch.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"

git push -u origin fix/<short-topic>
gh pr create --base main --head fix/<short-topic> --title "…" --body "…"
```

In the new PR body, explicitly state it addresses #N and why it's a separate PR
(release branch is protected). Map each fix back to the specific CI failure or
review comment it resolves.

## Step 6 — Close the loop on the release PR

For **each** original review comment, reply pointing to the new PR, then resolve
the thread.

```bash
# Reply (use the REST comment id from Step 2)
gh api repos/ClickHouse/clickhouse-js/pulls/<N>/comments/<COMMENT_ID>/replies \
  -f body='Fixed in #<NEW_PR>. <one line on what changed>. (Lands on `main` separately since this PR targets the protected `release` branch.)' \
  -q '.html_url'

# Resolve the thread (use the PRRT_… node id from Step 2)
gh api graphql \
  -f query='mutation($id:ID!){resolveReviewThread(input:{threadId:$id}){thread{id isResolved}}}' \
  -f id='<THREAD_NODE_ID>' \
  -q '.data.resolveReviewThread.thread | "\(.id) resolved=\(.isResolved)"'
```

## Step 7 — Flag the re-sync

The fix is on `main`, not on `release`. Remind the maintainer that once the new
PR merges, the `release` branch / the release PR must be re-synced from `main`
to pick the fix up. Do not attempt to push to `release` yourself.

## Quick reference — the whole flow

1. `gh pr view <N> --json baseRefName` → confirm base is `release`.
2. `gh pr checks <N>` + `gh run view --job <id> --log-failed` → real CI failure (ignore the `success` gate).
3. `gh api …/pulls/<N>/comments` + GraphQL `reviewThreads` → review comments + thread ids.
4. `git checkout -b fix/… origin/main` → branch off latest `main`.
5. Fix → verify (prettier / typecheck / lint / tests / `node --check`).
6. Commit → push → `gh pr create --base main`.
7. Reply to each review comment (REST `…/comments/<id>/replies`) → resolve each thread (GraphQL `resolveReviewThread`).
8. Remind: re-sync `release` from `main` after merge.
