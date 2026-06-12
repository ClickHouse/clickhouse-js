---
name: typescript-lsp
description: >
  Use the TypeScript language server (`typescript-language-server`) for precise
  code intelligence in the `clickhouse-js` repository: go-to-definition, find
  references, hover (type signatures and JSDoc, including `@deprecated` info),
  workspace-wide symbol search, completions, and per-file type diagnostics.
  Prefer this over grep when you need to resolve a symbol's actual definition,
  find all usages of an exported API, or inspect inferred types across the
  `packages/*` workspaces. The server is preinstalled as a root devDependency —
  run the repository `setup` skill (`npm install`) first so `node_modules` is
  populated. Do NOT use this skill for downstream projects that merely depend
  on `@clickhouse/client`; it is specific to working inside this repo.
---

# TypeScript Language Server in clickhouse-js

`typescript-language-server` is declared as a root devDependency, so after
`npm install` (see the `setup` skill) it is available via `npx` and uses the
workspace-local `typescript` (6.x) compiler, matching CI exactly.

## Starting the server

From the repo root:

```bash
npx typescript-language-server --stdio
```

It speaks LSP (JSON-RPC, `Content-Length`-framed) over stdio. There is no
extra configuration: each `packages/*` workspace, `tests/clickhouse-test-runner`,
`examples/node`, and `examples/web` has its own `tsconfig.json`, and the
server picks the nearest one per opened file automatically.

## Protocol essentials

1. Send `initialize` with `rootUri`/`workspaceFolders` pointing at the repo
   root, then the `initialized` notification.
2. Send `textDocument/didOpen` with the full file text for every file you
   want to query (the server reads dependencies from disk on its own; only
   files you query positions in need to be opened).
3. Positions are **0-based** (line and character).

## Verified capabilities (typescript-language-server 5.x, TS 6.x)

| Request                   | Notes                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `textDocument/hover`      | Returns the full inferred signature + JSDoc markdown                                                                                                                                                            |
| `textDocument/definition` | Resolves across workspace packages via source, not `dist/`                                                                                                                                                      |
| `textDocument/references` | Within the opened file's project                                                                                                                                                                                |
| `workspace/symbol`        | e.g. query `ClickHouseClient` finds class + re-exports                                                                                                                                                          |
| `textDocument/completion` | Context-aware member completions                                                                                                                                                                                |
| Diagnostics               | **Push only** (`textDocument/publishDiagnostics` notifications, sent ~1–3s after `didOpen`). The pull `textDocument/diagnostic` request is _not_ supported (`-32601`) — wait for the push notification instead. |

## Tips

- If your environment provides built-in LSP/code-intelligence tooling, point
  it at `npx typescript-language-server --stdio` with the repo root as the
  workspace folder.
- For one-off scripted queries, spawn the server from Node, frame messages
  with `Content-Length: <bytes>\r\n\r\n<json>`, and match responses by `id`.
- A full workspace typecheck is still `npm run build && npm run typecheck`
  (build first — some workspaces import compiled `dist/` outputs); the LSP is
  for targeted, interactive queries, not for CI-equivalent validation.
