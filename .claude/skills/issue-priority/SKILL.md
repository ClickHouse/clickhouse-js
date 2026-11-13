---
name: issue-priority
description: >
  Decide the priority of a `ClickHouse/clickhouse-js` issue: `Urgent`, `High`,
  `Medium`, or `Low`, for the org issue field **Priority**. Use this skill when
  the task is to "prioritize", "set the priority of", "rate", or "triage" an
  issue, or to explain why an issue has a given priority. It defines the reach
  tiers of the packages, the severity rows, the base-level matrix, the
  modifiers, and the confidence.
---

# Issue priority

This skill is the single source of truth for the **Priority** of
`ClickHouse/clickhouse-js` issues. People and automated triage use the same
rules.

The value goes into the org issue field **Priority** (`Urgent`, `High`,
`Medium`, `Low`). The field is visible to org members only. An automated tool
sets the value once, never changes a value that is already set, and keeps the
level and its reason out of public comments.

## When to set no priority

Set no priority when one of these is true:

- A maintainer can close the issue with no further action: it is already fixed
  on `main`, a duplicate, works as intended, already supported, answered, or
  obsolete.
- Only a deprecated public API reaches the defect (a `@deprecated` JSDoc tag,
  or docs that call the API deprecated). Fixes to deprecated code are not
  released.
- The issue is a question, or it is about CI, the release process, or a
  discussion.

## 1. Reach

The reach is the tier of the most-used public path that reaches the defect,
not the tier of the file that contains it. `packages/client-common/src` is
linked into both clients as `src/common`, so the same file can be Core through
the Node.js client and Common through the Web client. `ResultSet.json()` on a
streamable JSON format goes through `stream()`, so a `stream()` defect that
`json()` reaches is Core.

| Tier      | Public paths                                                                                                                                                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Core      | `@clickhouse/client` (Node.js) `query()`, `insert()`, and `command()` with JSON formats; the connection layer (`packages/client-node/src/connection/`: socket pool, keep-alive, abort); auth and TLS; error handling and the result set (`result_set.ts`); query parameters; code in `packages/client-common/src` that the Node.js client reaches |
| Common    | compression; `ResultSet.stream()`; `insert()` from a stream or with a non-JSON format (CSV, TSV, Parquet); sessions and roles; the tracer; multipart parameters (`use_multipart_params`); `@clickhouse/client-web`                                                                                                                                |
| Narrow    | `exec()` with raw formats; edge runtimes; rare types (Geo, Dynamic, Variant)                                                                                                                                                                                                                                                                      |
| Satellite | `@clickhouse/rowbinary` (`skills/clickhouse-js-node-rowbinary/`), `@clickhouse/datatype-parser` (`packages/datatype-parser/`), the other agent skills (`skills/`), `examples/`, `demo/`, `docs/`                                                                                                                                                  |

## 2. Severity

Use the first row that fits:

| Severity                | Use when                                                                                                                                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Wrong data or security  | the client returns or stores wrong or incomplete data with no error, or reports success for a query that failed; or a security defect                                                                                                                                          |
| Broken, no workaround   | the feature fails (an error, a hang, a crash, a leak that ends in a crash or in exhausted sockets), and the caller has no reasonable workaround; also a wrong or incomplete error with no workaround: the failure is reported, but its type, code, or message is wrong or lost |
| Workaround exists       | the feature fails, but the caller can avoid the failure with a small change in their own code (name the workaround in the reason); also a result that is correct but slow or uses too much memory                                                                              |
| Cosmetic, docs, feature | wrong log or message text, documentation, a feature request                                                                                                                                                                                                                    |

## 3. Base level

| Severity ↓ / Reach →    | Core   | Common | Narrow | Satellite |
| ----------------------- | ------ | ------ | ------ | --------- |
| Wrong data or security  | Urgent | Urgent | High   | Medium    |
| Broken, no workaround   | High   | High   | Medium | Low       |
| Workaround exists       | Medium | Medium | Low    | Low       |
| Cosmetic, docs, feature | Low    | Low    | Low    | Low       |

## 4. Modifiers

Apply them in this order:

1. **Security with a shown path from untrusted input.** The issue or a
   reproduction shows how a value that an application takes from its users
   reaches the defect: `Urgent` at any reach. Skip the other modifiers. A
   defect that puts a caller-supplied value into SQL without quoting or
   escaping is a candidate: look for such a path. If none is shown, rate the
   defect by the failure that it shows. A report that discloses a
   vulnerability goes to a private channel, not to a public issue.
2. **Regression in the latest published release** of the package that has the
   problem: up one level. This can give `Urgent`. It is a regression only when
   the latest release shows the problem and the release before it does not.
   The tags are per package: `client-X.Y.Z` (Node.js client),
   `client-web-X.Y.Z`, `datatype-parser-vX.Y.Z`, `rowbinary-vX.Y.Z`.
3. **Customer request in Linear.** The issue links (`linear.app`) a Linear
   issue for a customer request: up one level, but never to `Urgent` (`High`
   stays `High`).

## 5. Confidence

A missing reproduction lowers the confidence, not the level. Record the
confidence with the value when the tool that sets it supports it:

| Confidence | Use when                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------- |
| `HIGH`     | a run shows the problem (or, for a feature, code inspection confirms its absence on `main`) |
| `MEDIUM`   | code inspection shows a defect, but no reproduction was run (for example, it needs ClickHouse Cloud) |
| `LOW`      | the report lacks what a reproduction needs, or a run did not show the problem            |

## 6. Reason

Write one line with the value:

`<tier> (<path>) · <severity> · <modifiers, or "no modifier"> → <level>.`

Name the workaround when the severity is "Workaround exists". When the
confidence is `LOW`, say what is missing.

## 7. `@clickhouse/rowbinary` codecs

The `clickhouse-js-node-rowbinary` skill copies the reader and writer code into
the codecs that it generates in the user's project. A new release does not
change code that users already generated. A fix for a defect in that code, or
for a `@clickhouse/datatype-parser` defect that changes the generated code,
needs a line in `skills/clickhouse-js-node-rowbinary/CHANGELOG.md` that tells
users to regenerate their codecs. The priority stays as the table gives it.
