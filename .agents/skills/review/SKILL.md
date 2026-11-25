---
name: review
description: >
  Review a change to `ClickHouse/clickhouse-js` locally: your own branch
  before a PR, a PR from another person, or uncommitted changes. Use it when
  the task is to "review" a PR, a branch, a diff or a fix in this repository.
  Args: a PR number, a branch, a range (`<base>..<head>`), or nothing.
---

# Review a clickhouse-js change

This is a pointer. The process and the criteria have one copy, for all agent
harnesses:

1. Read `.claude/skills/review/SKILL.md` (the process) and follow it.
2. Read `.claude/skills/review/review-core.md` (the criteria) and apply it.

Where the process names a tool that this harness does not have (the built-in
`code-review` skill, a subagent, the `docs-drift-reviewer` agent), do that pass
yourself and say in the report that it was not independent.
