# Skills

This directory contains agent skills for working with `@clickhouse/client` and
`@clickhouse/client-web`. Each subdirectory is a self-contained skill consisting
of a `SKILL.md` entry point plus any supporting `reference/` and `evals/` files.

Available skills:

- `clickhouse-js-node-troubleshooting` — troubleshooting playbook for the
  Node.js client.

## Installing a skill into your agent

Each skill is a directory containing `SKILL.md` and supporting files. To install
one, copy that directory into the location your agent reads skills/instructions
from. Replace `<skill>` below with the skill directory name (e.g.
`clickhouse-js-node-troubleshooting`).

### Claude Code

Claude Code auto-discovers skills placed under a `skills/` directory in either
the user-level or project-level config.

- User-level (available in every project): copy the skill directory into
  `~/.claude/skills/<skill>/`.
- Project-level (only available in the current project): copy it into
  `.claude/skills/<skill>/` at your project root.

Either copy the files manually, or use `git` / `npm pack` to pull just the
`skills/<skill>` directory out of this repository's published source. After the
files are in place, restart Claude Code (or reload the workspace) — the skill
will be triggered automatically based on the `description` field in `SKILL.md`.

### Codex CLI / other AGENTS.md-based agents

Agents that read `AGENTS.md` (Codex CLI, and several other coding agents) do not
have a dedicated "skills" loader. Wire the skill in by placing it somewhere your
agent can read and referencing it from `AGENTS.md`:

1. Put the skill files somewhere accessible to the agent — for example
   `.agent/skills/<skill>/` in your project, or `~/.codex/skills/<skill>/` for a
   global setup.
2. Add a short pointer to the relevant `AGENTS.md` so the agent loads it on
   demand:

   ```md
   ## Skills

   - When troubleshooting `@clickhouse/client` (Node.js) issues, follow
     `.agent/skills/clickhouse-js-node-troubleshooting/SKILL.md` and consult the
     files under its `reference/` directory.
   ```

Use an absolute path in the pointer when installing the skill globally.

### Other agents

Any agent that can be pointed at a local Markdown file can use these skills:
make `<skill>/SKILL.md` available as system/instruction context, and let the
agent open the files under `reference/` on demand. The `description` field at
the top of each `SKILL.md` is written to act as the trigger condition.
