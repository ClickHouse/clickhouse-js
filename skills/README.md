# Skills

This directory contains agent skills for working with `@clickhouse/client` and
`@clickhouse/client-web`. Each subdirectory is a self-contained skill consisting
of a `SKILL.md` entry point plus any supporting `reference/` and `evals/` files.

Available skills:

- `clickhouse-js-node-troubleshooting` — troubleshooting playbook for the
  Node.js client.

## Installing a skill into your agent

The instructions below assume you have a local clone of this repository. Replace
`<skill>` with the skill directory name (e.g. `clickhouse-js-node-troubleshooting`)
and adjust paths as needed for your OS.

### Claude Code

Claude Code auto-discovers skills placed under a `skills/` directory in either
the user-level or project-level config.

- User-level (available in every project):

  ```sh
  mkdir -p ~/.claude/skills
  cp -R ./skills/<skill> ~/.claude/skills/
  ```

- Project-level (only available in the current repo):

  ```sh
  mkdir -p .claude/skills
  cp -R /path/to/clickhouse-js/skills/<skill> .claude/skills/
  ```

Restart Claude Code (or reload the workspace) and the skill will appear and be
triggered automatically based on the `description` field in `SKILL.md`.

### Codex CLI / other AGENTS.md-based agents

Agents that read `AGENTS.md` (Codex CLI, and several other coding agents) do not
have a dedicated "skills" loader. Wire the skill in by referencing it from the
`AGENTS.md` that the agent already reads:

1. Copy the skill into your project (or point at the cloned repository):

   ```sh
   mkdir -p .agent/skills
   cp -R /path/to/clickhouse-js/skills/<skill> .agent/skills/
   ```

2. Add a short pointer to your project's `AGENTS.md` so the agent loads it on
   demand:

   ```md
   ## Skills

   - When troubleshooting `@clickhouse/client` (Node.js) issues, follow
     `.agent/skills/clickhouse-js-node-troubleshooting/SKILL.md` and consult the
     files under its `reference/` directory.
   ```

For a global setup, place the same snippet in `~/.codex/AGENTS.md` (or the
agent's equivalent global instructions file) and use an absolute path to the
skill directory.

### Other agents

Any agent that can be pointed at a local Markdown file can use these skills:
load `skills/<skill>/SKILL.md` as system/instruction context, and let the agent
open the files under `reference/` on demand. The `description` field at the top
of each `SKILL.md` is written to act as the trigger condition.
