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

When reviewing PRs to the `release` branch focus on flagging breaking changes and security issues in the broader context, as PRs to the `release` branch are normally bigger and include a cummulative change from a number of PRs.
