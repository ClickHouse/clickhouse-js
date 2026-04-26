# Skills

This directory contains agent skills for working with `@clickhouse/client` and
`@clickhouse/client-web`. Each subdirectory is a self-contained skill consisting
of a `SKILL.md` entry point plus any supporting `reference/` and `evals/` files.

Available skills:

- `clickhouse-js-node-troubleshooting` — troubleshooting playbook for the
  Node.js client.

## Installing a skill into your agent

The easiest way to install these skills is with the [`skills`](https://skills.sh/)
CLI, which knows how to wire skill files into the directories that agents like
Claude Code, Cursor, and Codex CLI read from.

Add all skills from this repository to the current project:

```sh
npx skills add ClickHouse/clickhouse-js
```

Useful variations:

- `npx skills add ClickHouse/clickhouse-js -g` — install globally (user-level)
  instead of project-level.
- `npx skills add ClickHouse/clickhouse-js --skill clickhouse-js-node-troubleshooting`
  — install only a specific skill.
- `npx skills add ClickHouse/clickhouse-js --agent claude-code` — install for a
  specific agent only (omit to be prompted, or use `--agent '*'` for all).
- `npx skills add ClickHouse/clickhouse-js -l` — list skills available in this
  repository without installing anything.

Run `npx skills --help` for the full list of commands and options (including
`list`, `remove`, and `update`).
