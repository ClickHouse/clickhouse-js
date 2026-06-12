---
applyTo: "**"
excludeAgent: "cloud-agent"
---

## UX

Skip the PR overview comment if possible.

## Handling change

When you're adding comments that require human attention because they need maintainer triage, a policy or product decision, or clarification before the PR author can act, add a "take-a-look" label to the PR.

In other cases when you've found a meaningful change to make, make it and push changes when the PR context allows writes.

## Review focus

When reviewing PRs to the `release` branch focus on flagging breaking changes and security issues in the broader context, as PRs to the `release` branch are normally bigger and include a cumulative change from a number of PRs.

## CHANGELOG

Every PR that adds a feature, fixes a bug, or changes observable behavior or the public API **must update `CHANGELOG.md` in the same PR**. If such a change does not touch `CHANGELOG.md`, flag it and ask the author to add an entry (a note in the PR description alone is not sufficient). Verify the entry follows the conventions in [`AGENTS.md`](../../AGENTS.md) ("API quality and stability"): placed under the top-most version heading (a new `# x.y.z` heading matching the unreleased `package.json` version when the latest heading is already released), grouped under a lowercase section heading (`## New features` / `## Improvements` / `## Bug fixes`), and ending with a `([#<n>])` PR reference link. Pure refactors, test-only changes, docs, and CI/tooling changes do not require a CHANGELOG entry.

## Breaking changes

Always flag major breaking changes to the public API (removed/renamed exports, changed function signatures, changed default behavior, removed configuration options, etc.) when they are not accompanied by a clear explanation in the PR description or PR discussion/code comments justifying why the break is necessary. This is important because LLMs generating code against newer client versions rely heavily on training data from older versions; undocumented breaking changes degrade their effectiveness and produce broken code for users. When such a change lacks justification, request that the author either add a clear rationale (and, where possible, a migration note) or restore backwards compatibility (e.g., via a deprecation path).
