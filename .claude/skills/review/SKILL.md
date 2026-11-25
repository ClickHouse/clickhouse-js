---
name: review
description: >
  Review a change to `ClickHouse/clickhouse-js` locally: your own branch
  before a PR, a PR from another person, or uncommitted changes. It applies
  the repository's review criteria (`review-core.md`), runs the tests (also
  against the old code), starts independent reviewers, checks each finding
  against the code, and writes a report. It never posts to GitHub unless the
  user asks for it and approves the text. Use it when the task is to "review"
  a PR, a branch, a diff or a fix in this repository. Args: a PR number, a
  branch, a range (`<base>..<head>`), or nothing (the current changes).
---

# Review a clickhouse-js change

The criteria are in [`review-core.md`](review-core.md). Read it first. This
file is the process. Do the steps in order. When you skip a step, say why in
the report.

## 1. Target and intent

- **PR number:** `gh pr view <n> --comments` and `gh pr diff <n>`, the linked
  issue, and the reviews that exist. Do not repeat a point that another
  reviewer made; say that you agree.
- **Range:** `git diff <base> <head>`.
- **Branch:** `git diff main...<branch>`. **Nothing:** `git diff`, else
  `git diff main...HEAD`.
- Write the intent in one or two sentences: what the change promises, and what
  must stay true. Decide the kind: bug fix, feature, or other.
- Read the root `AGENTS.md` and the `AGENTS.md` nearest to each changed file.

## 2. A checkout that you can run

- Your own change: the current checkout.
- A PR from another person: a separate worktree under `.local/` (git-ignored),
  for example `git worktree add .local/pr<n> <pr-head>`. Do not push to the
  author's branch.
- After `npm install`, restore `package-lock.json` if it changed.

## 3. Tests

- Run the setup skill if `node_modules` is missing. Then choose the tests by
  what the change touches (commands in `review-core.md`):
  - client code: the unit tests of the changed packages, then the
    integration tests;
  - types only: `npm run typecheck`, and read the types of changed test files
    (`typecheck` checks only `src/`);
  - CI workflows, scripts or the test harness: run the changed script or a
    dry run of it, and the harness's own tests. Do not run the client
    integration suites for them.
- **Old code.** The tests of the changed behavior must fail on the old code.
  Do not change the files of the review checkout: make a second worktree at
  the base (`git worktree add --detach .local/base-<n> <base>`, with a name of
  its own), run `npm ci` and `npm run build` in it, copy the new test files
  into it, run them there, and remove it after. Do not link the review
  checkout's `node_modules` into it: the workspace links in
  `node_modules/@clickhouse/` would point to the new code. Do not use
  `git stash`.
  When the change has no test, write a small probe test in `.local/` and run
  it on both commits.
- **A run counts only when** the exit code is 0, the summary shows a test
  count above 0, and the new tests are in the output as run, not skipped. A
  run that must fail (for example a `KNOWN_FAILURES` group) counts when it
  fails for the expected reason.
- A test that fails on the base commit too, with the same server, is not a
  finding of this change (for example a server newer than the code). Name it
  in one line under the test results.
- **Wait in the same turn.** While tests or reviewers run in the background,
  check their results again in the same turn. Do not end your turn to wait
  for a notification: in some harnesses no notification wakes you.

## 4. Independent reviewers (at the same time)

Give each reviewer the target, the intent and the path of `review-core.md`, not
your own conclusions. Ask it to attack the assumptions of the change.

1. **Checklist:** a fresh subagent first picks the sections of
   `review-core.md` that the changed files touch, then goes through their
   items: OK (with `file:line`) or finding. It does not list the items that do
   not apply. It reads the code around the diff, the callers, and the twin code
   in the other client.
2. **Bug review:** the built-in `code-review` skill at `high`, with the exact
   range or PR in its arguments, and no `--comment` and no `--fix`. It runs
   as a fork and gets only its arguments, so restore setup changes (such as
   `package-lock.json`) first. If it is not available, a second fresh subagent
   that looks only for bugs.
3. **Docs:** when the change touches user docs or contributor docs (README,
   CONTRIBUTING, `AGENTS.md`, harness docs) or what they describe, the
   `docs-drift-reviewer` agent in report-only mode.
4. **Other clients:** a fresh subagent checks how the other ClickHouse clients
   (Go, Java, C#, Python, Rust, C++) solve the same problem, with
   `gh search code --owner ClickHouse <term>` or local checkouts of their
   `main`. It reports for each client: the same design, a different design
   (which one), or the same bug, and whether the change goes against a design
   that the other clients share.
5. **A second model**, if you have one (for example Codex), with the same brief.

If a reviewer is not available, do that pass yourself and say in the report
that it was not independent.

## 5. Check each finding

- Check each finding against the code before you report it. When you can,
  prove it: a failing test, or a small script in `.local/` against the real
  server. Drop what does not hold, and say that you dropped it.
- Remove duplicates. Apply the severity scale and the "Low-value findings"
  rule of `review-core.md`: lower those to one-line nits, do not drop them. Another case of the bug that the PR fixes is an
  incomplete fix (`should_fix` or `must_fix`), not `pre_existing`.

## 6. Report

Result first: can it merge, yes or no, and the one main reason. Then:

- the findings, most severe first: `file:line`, what is wrong, what goes wrong
  for a user (a concrete scenario), the evidence, and the fix;
- the test results: unit, integration, old-code check;
- the reviewer findings that you rejected, one line each;
- what you did not check.

Keep it short. Do not list the checklist items that do not apply.

## 7. GitHub (only when the user asks)

Write the review as a draft in `.local/pr<n>-review.md`: a short thank-you, the
main points, and the inline comments (file, line, text). Show it to the user.
Post it only after the user approves the final text, as one review. Add a
label only when the user says so.

Remove the worktrees under `.local/` when the review is done.
