# Recommendations for AI agents

> **Audience:** This file contains guidance for AI agents contributing to the `ClickHouse/clickhouse-js` repository itself. It is **not** intended for downstream projects that depend on `@clickhouse/client` or `@clickhouse/client-web`

This root file holds repo-wide guidance. Folder-specific guidance lives in nested `AGENTS.md` files next to the code they describe — read the one closest to the files you are editing:

- [`packages/AGENTS.md`](packages/AGENTS.md) — client source packages: log-message conventions, package structure, and intentional node/web duplication.
- [`examples/AGENTS.md`](examples/AGENTS.md) — the example corpus layout and conventions.
- [`skills/AGENTS.md`](skills/AGENTS.md) — shipped agent skills and how they are declared.
  - [`skills/clickhouse-js-node-rowbinary-parser/AGENTS.md`](skills/clickhouse-js-node-rowbinary-parser/AGENTS.md) — `@clickhouse/rowbinary` reader/writer conventions (tests, no defensive validation).
- [`docs/AGENTS.md`](docs/AGENTS.md) — embedded troubleshooting / how-to pages.
- [`tests/clickhouse-test-runner/AGENTS.md`](tests/clickhouse-test-runner/AGENTS.md) — the upstream SQL test harness and allowlist strategy.

## Code intelligence (TypeScript LSP)

The repository ships `typescript-language-server` as a root devDependency, so after `npm install` you can start a TypeScript language server with `npx typescript-language-server --stdio` from the repo root for precise go-to-definition, find-references, hover (signatures and JSDoc, including `@deprecated`), workspace symbol search, completions, and type diagnostics. Prefer it over text search when resolving symbols or usages across the `packages/*` workspaces. See [`.claude/skills/typescript-lsp/SKILL.md`](.claude/skills/typescript-lsp/SKILL.md) for verified capabilities and protocol notes.

## When reviewing code changes

For every pull request review, make sure to provide an evaluation of the following aspects:

### Security implications

1. This repository is a client library for ClickHouse, which is a database management system. When reviewing code changes, it is important to consider the security implications of the changes. For example, if the code changes involve handling user input or interacting with external systems, it is important to ensure that the code is secure and does not introduce vulnerabilities such as SQL injection or cross-site scripting (XSS).

2. Additionally, when reviewing code changes, it is important to consider the potential impact on data privacy and compliance with relevant regulations such as GDPR or CCPA. For example, if the code changes involve handling personally identifiable information (PII), it is important to ensure that the code is designed to protect user privacy and comply with relevant regulations.

### API quality and stability

1. When reviewing code changes, it is important to consider the impact on the API quality and stability. For example, if the code changes involve modifying the library's public API surface (such as exported functions, classes, or types) or adding new public APIs, it is important to ensure that the changes are well-documented and do not break existing functionality for users of the library.

2. When introducing new features, fixing bugs, or making any change to observable behavior or the public API, you **must update the changelog of every affected package in the same PR** — do not defer it to "release time" or leave it only in the PR description. This satisfies the PR template checklist item ("A human-readable description of the changes was provided to include in CHANGELOG"). Each package keeps its own changelog (the repository-wide [`CHANGELOG.md`](CHANGELOG.md) is **frozen** — do not add new entries there):
   - `@clickhouse/client` → [`packages/client-node/CHANGELOG.md`](packages/client-node/CHANGELOG.md)
   - `@clickhouse/client-web` → [`packages/client-web/CHANGELOG.md`](packages/client-web/CHANGELOG.md)
   - `@clickhouse/client-common` (deprecated) → [`packages/client-common/CHANGELOG.md`](packages/client-common/CHANGELOG.md)
   - `@clickhouse/datatype-parser` → [`packages/datatype-parser/CHANGELOG.md`](packages/datatype-parser/CHANGELOG.md)
   - `@clickhouse/rowbinary` → [`skills/clickhouse-js-node-rowbinary-parser/CHANGELOG.md`](skills/clickhouse-js-node-rowbinary-parser/CHANGELOG.md)

   A change to shared code that is bundled into both clients (the common module) affects **both** `@clickhouse/client` and `@clickhouse/client-web`, so update both of their changelogs. Follow the existing format exactly:
   - Entries go under the **top-most version heading** of that package's changelog. If the most recent `# x.y.z` heading corresponds to an **already-released** version (check `git tag`), open a **new** top-level `# x.y.z` heading that matches the unreleased version in that package's `package.json`; otherwise append to the existing top heading.
   - Group entries under lowercase section headings, reusing the ones already in the file: `## New features`, `## Improvements`, `## Bug fixes` (and `## Migration Notes` / `## Breaking changes` when relevant).
   - Write a concise, human-readable entry, add an example usage when it helps, and end it with a PR reference link, e.g. `([#825])` plus a matching `[#825]: https://github.com/ClickHouse/clickhouse-js/pull/<n>` reference at the bottom of the section.
   - When a change is Node.js- or Web-only, say so explicitly in the entry (e.g. "(Node.js only)").
   - Run `npx prettier --write` on the changelog file(s) you touched before committing.

3. Additionally, make sure that the official documentation is in sync with the changes.
