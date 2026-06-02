---
applyTo: '**'
excludeAgent: 'cloud-agent'
---

## UX

Skip the PR overview comment if possible.

## Handling change

When you're adding comments that require human attention because they need maintainer triage, a policy or product decision, or clarification before the PR author can act, add a "take-a-look" label to the PR.

In other cases when you've found a meaningful change to make, make it and push changes when the PR context allows writes.

## Review focus

When reviewing PRs to the `release` branch focus on flagging breaking changes and security issues in the broader context, as PRs to the `release` branch are normally bigger and include a cumulative change from a number of PRs.

## Breaking changes

Always flag major breaking changes to the public API (removed/renamed exports, changed function signatures, changed default behavior, removed configuration options, etc.) when they are not accompanied by a clear explanation in the PR description or PR discussion/code comments justifying why the break is necessary. This is important because LLMs generating code against newer client versions rely heavily on training data from older versions; undocumented breaking changes degrade their effectiveness and produce broken code for users. When such a change lacks justification, request that the author either add a clear rationale (and, where possible, a migration note) or restore backwards compatibility (e.g., via a deprecation path).
