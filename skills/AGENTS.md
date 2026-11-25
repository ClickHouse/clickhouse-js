# Recommendations for AI agents — `skills/`

Guidance for the shipped agent skills. See the [repo-root `AGENTS.md`](../AGENTS.md) for cross-cutting guidance. The `@clickhouse/rowbinary` skill has its own [`clickhouse-js-node-rowbinary/AGENTS.md`](clickhouse-js-node-rowbinary/AGENTS.md).

- Each shipped skill must also be listed in the `agents.skills` array of
  [`packages/client-node/package.json`](../packages/client-node/package.json) so downstream tooling can
  discover it. The [`Skills E2E`](../.github/workflows/e2e-skills.yml) workflow
  (`tests/e2e/skills/check.js`) asserts that the packaged tarball contains the declared skills.
- A skill names only things that exist: sibling skills that are in this directory, packages by their
  published names (`@clickhouse/client`, `@clickhouse/client-web`), and APIs with their real
  behavior. Check each claim against the code: for example, `ping()` does not check credentials, but
  `ping({ select: true })` does.
