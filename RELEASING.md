# Release process

The release process now lives in the in-repo **`release` skill**, which is the
single source of truth and is kept in step with the GitHub Actions workflows:

- [.claude/skills/release/SKILL.md](.claude/skills/release/SKILL.md)

It covers all the packages — `@clickhouse/client`, `@clickhouse/client-web`,
the deprecated `@clickhouse/client-common`, and the standalone
`@clickhouse/datatype-parser` and `@clickhouse/rowbinary` — including version
bumping, syncing the protected `release` branch from `main`, the `npm-publish`
approval gate, and creating the GitHub Release from `CHANGELOG.md`.

If you use Claude Code in this repo, just ask it to "release `<package>`" and it
will drive the process. Otherwise, follow the steps in the skill document
directly.
