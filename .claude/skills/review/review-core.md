# clickhouse-js review core

What to check in a change to `ClickHouse/clickhouse-js`, and how to weigh it.
The `SKILL.md` next to this file says how to run a review. This file is the
only place for the review criteria: other review instructions point here.

Each item is a check to apply to the code that the diff touches. Read the
code, the callers, and the twin code in the other client. Do not mark an item
"OK" because the diff looks like a correct pattern. The PR numbers in
parentheses are the sources: real incidents, or review feedback that the
authors accepted. You do not need to open them.

## Severity

- `must_fix`: wrong data, lost or duplicated rows, an error that does not
  reach the caller, a hang, a crash, a security or privacy problem, a breaking
  change with no note, SQL parsing in the client, a change that makes CI fail
  (a build, a lint or a test suite that passed on the base).
- `should_fix`: a missing test, changelog entry or docs; a fix in one client
  that the other client needs too; a changelog or docs claim that is not true
  (user docs and contributor docs: README, CONTRIBUTING, `AGENTS.md`, harness
  docs); another case of the same bug that the PR fixes (an incomplete fix).
- `nit`: a small thing. At most three in the GitHub draft; list the others in
  one line in the report.
- `pre_existing`: a real problem that the change did not cause and does not
  promise to fix. Propose an issue; do not block the PR.

## A. Errors and streams (check these first)

1. **An error reaches the caller.** The client does not log an error and go on.
   Every error path rejects the promise or fails the stream. A Node.js callback
   with a falsy first argument means success, so wrap a non-Error value
   (#1141: the insert resolved and 499 of 1000 rows were lost).

   ```js
   catch (e) { callback(e) }                                            // wrong
   catch (e) { callback(e instanceof Error ? e : new Error(String(e))) } // right
   ```

2. **No `'error'` with no listener, no rejection with no handler**, also in
   cleanup code: `close()` or `destroy(err)` on a stream that the caller never
   got, or a cleanup promise that nobody awaits (#1087). A test that adds its
   own `'error'` listener can hide this. Not a finding: a test helper started
   without `await` on purpose, so that its rejection fails the run.
3. **Errors after HTTP 200.** The server can send rows and then an exception in
   the body, marked with the tag from `x-clickhouse-exception-tag`
   (`EXCEPTION_TAG_HEADER_NAME`). Both `result_set.ts` files must find it, in
   every format and read mode, with no false positive on a successful body
   that contains similar text. In `...WithNames` formats the first rows are
   names and types, not the exception (#975, #1085, #1168).
4. **Error parsing** gives a `ClickHouseError` with the right code, also when
   the message contains the parser's own markers such as `, Stack trace (`
   (#1174).
5. **Chunk boundaries.** The network cuts the body at any byte: inside a row,
   inside a multi-byte UTF-8 character, inside a marker. Check the code that
   keeps the rest of a chunk, and the last row with no newline (#1167).
6. **Rows that the client has but the caller did not read** reach the caller
   before the error, or the loss is documented (#1167).
7. **A promise that wraps a stream settles on every end:** `end`, `error`, and
   `close` with no `end` before it. Prefer `for await` or `pipeline()` to a
   hand-made promise with listeners. A custom Writable's `final(callback)`
   calls its callback (#520, #542, #836).
8. **Backpressure.** When `write()` returns `false`, wait for `'drain'`. In
   object mode, `highWaterMark` counts objects, not bytes (#1141).
9. **Write Buffers, not strings, to `node:http`.** Node.js 24.22.0+ and 26.9.0+
   stall on non-ASCII strings: `'drain'` never comes (#1148,
   nodejs/node#66781).
10. **Every wait, listener and timer has an exit.** Remove the listener on the
    caller's `AbortSignal` when the request ends. `unref()` internal timers and
    clear them on success and on error. A second `abort()` is safe (#167,
    #601).
11. **Event-loop order.** Code that expects a fixed order of `setImmediate`,
    `process.nextTick` and microtasks breaks with other chunk sizes or a slow
    consumer (#975).
12. **Fixed-size write buffers hold whole rows.** An encoder never sends a half
    row, reports how many rows it wrote, and does not reuse a buffer that the
    transport did not finish sending (#911, #915).

## B. Requests, settings and values

13. **No SQL parsing in the client.** No regex, lexer or string search on the
    user's query. Use a server setting, a header, or an explicit wrapper such
    as `TupleParam` (closed series #1067 to #1072).
14. **Server settings are modeled as the server does.** A setting listed as
    client-only is dropped with no error. Use the server's value range
    (`readonly` is `0 | 1 | 2`; a UInt64 value can be a string) (#706, #422).
15. **Settings and headers that the client sends itself.** Check what happens
    when the user sends the same one: at client level and per call, in any
    letter case, as a header and as a setting. `X-ClickHouse-Format` wins over
    `default_format`, and formats have aliases (`TSV` = `TabSeparated`)
    (#1085).
16. **Binary formats need a binary reader.** `ResultSet.stream()` is line-based:
    Parquet, Arrow and RowBinary need the raw stream. `row.json()` is only for
    JSON formats (#702).
17. **Precision and time.** 64-bit integers, Decimal and DateTime64 do not go
    through a `number`. To a coarser time unit, floor: do not round, do not
    truncate toward zero (#908, #911).

## C. Both clients and shared code

18. **Node/Web twins.** The duplication between `client-node` and `client-web`
    is intentional (`packages/AGENTS.md`): do not ask to merge it. But a fix in
    one twin usually needs the same fix in the other
    (`result_set.ts`, `node_base_connection.ts` ↔ `web_connection.ts`). An
    intentional difference needs a comment, not a fix.
19. **Shared code.** `client-common/src` is bundled into both clients through
    the `src/common` symlink. No Node.js-only or Web-only APIs in it. A change
    there needs both changelogs and tests in both clients.
20. **Web code does not assume Node.js.** `fetch` network errors are opaque (no
    `ECONNREFUSED`), CORS can fail a request, some browsers cannot stream
    request bodies, and `keepalive` is not TCP keep-alive (#685, #224).

## D. Public API

21. **No accidental breaking change.** Exports, signatures, option names,
    defaults, error types and codes. Also breaking: a new precedence rule, a
    check that starts to validate something (make it opt-in, #442), a change of
    how a value is parsed. In TypeScript: a wider union, a new required
    generic, a required constructor parameter, an `enum` replaced by an object
    (#793), a stricter compiler flag that changes the published `.d.ts`.
    Exception: a change to behavior that was never released (check `git tag`)
    is not breaking.
22. **A new option exists in both clients** when it makes sense in both, with the
    same name and default. A Node.js-only option says so in the docs.
23. **Keep the API small.** One general mechanism (per-request `http_headers`)
    before an option for one feature. Return an object (`{ query_id }`), not a
    bare value. snake_case option names. A per-request override when the value
    can change between queries (#395, #584).
24. **Types say exactly what the code handles.** No new `any`. Literal unions for
    fixed string sets, an exhaustive `switch` with a `never` check, `field?: T`
    instead of a sentinel value (#836).

## E. Tests

25. **The tests of the changed behavior fail on the old code.** Run them against
    the base commit in a second worktree.
26. **Both sides of each new branch:** option set and unset, input accepted and
    rejected, for each connection that uses it (#716, #879).
27. **Unit and integration tests.** Integration tests use the real server. If a
    test cannot exist, the PR says why.
28. **The run exercises the PR's code.** A harness resolves the client from the
    checkout, not from npm. A new suite is in CI. A replaced runner keeps the
    old cases (#735, #920).
29. **No silent skips.** A skipped test names its reason and issue. A missing
    test dependency fails the run (#708).
30. **Assertions check the result,** not only "did not throw". A fuzz or a
    generator that leaves out some inputs needs a separate test for them.
31. **Runtimes:** Node.js 22, 24 and 26, Bun, and the Web client, where the code
    runs. If a runtime is not available locally, say so in one line and leave
    it to CI. Vitest with green tests but unhandled errors fails: check the
    exit code.
32. **Types in test files.** `npm run typecheck` checks only `src/`, and Vitest
    removes types without checking them. So read the types in changed test
    files yourself: for example, a type annotation that names a value (a
    `const` object) is an error that no CI job finds (#1103).
33. **Upstream SQL tests.** For transport, result-set or error-parsing changes,
    follow `tests/clickhouse-test-runner/AGENTS.md` and propose the
    `tests:run-core-sql` label.

## F. Security and privacy

34. **No query text, request bodies or credentials in logs, errors or traces,**
    unless the user turned on the opt-in flag. Check each log call site and
    that the flag reaches it from the config. A user span attribute cannot set
    a reserved key such as `db.query.text` (#110, #520, #886, #950).
35. User values reach SQL only as query parameters or through the existing
    escaping. TLS and auth defaults are not weaker than before.

## G. Changelog, docs, CI and packaging

36. **Changelog** (rules in the root `AGENTS.md`): the right package
    changelogs, the version heading (released or not: `git tag`; without tags,
    a top heading that equals the `package.json` version is released), the
    section
    (a change of released behavior goes under `## Breaking changes` or
    `## Migration Notes`), and each claim checked against the code (#1141).
37. **Docs, skills and examples say what the code does:** option names, types,
    defaults, and what a method really does (`ping()` does not check
    credentials, `ping({ select: true })` does). They name only things that
    exist (#702). This includes contributor docs (README, CONTRIBUTING,
    `AGENTS.md`, harness docs). Run the `docs-drift-reviewer` agent in
    report-only mode.
38. **Publish workflows:** path filters include `packages/client-common/src/**`
    and the files that `prepack` copies; triggers list `main` and `release`
    (#914).
39. **CI supply chain:** third-party actions pinned to a commit SHA, explicit
    `permissions:`, a dependency gate that fails closed (#769, #886).
40. **Package config:** `main`, `types` and `exports` point to files that the
    build emits; a devDependency that raises the Node.js floor updates
    `engines.node`; a blocking lint rule is `error` (#885, #643).

## Low-value findings

Maintainers rejected these kinds again and again. Do not drop them: report
each one as a `nit` in one line, unless you can show a real failure (a test,
a trace, a run), which makes it a normal finding. A CI or script change that
does not do what it says is always a normal finding.

- claims that nobody checked ("implicit conversion", "invalid syntax", "out of
  memory risk") with no test or trace;
- the wording of comments, PR descriptions and doc margins;
- the intent of test code (a helper started without `await` on purpose);
- runtime validation in hot-path writers, a second guard after validation,
  or a guard for an API that all supported runtimes have;
- a breaking or deprecation note for a version that was never released;
- performance claims with no measurement;
- node/web duplication.

## Commands

- Set up a checkout: the `setup` skill (`npm install`, `npm run build`).
- Unit tests, no server: `npm run test:node:unit`, `npm run test:web:unit`.
  One file (by name): `npm --prefix packages/client-node run test:unit -- run
<name>`. The Web unit tests need a browser: `npx playwright install
chromium`.
- Integration tests: `npm run test:node:integration`,
  `npm run test:web:integration`. They need ClickHouse on port 8123:
  `docker compose up -d` from the main checkout. In a second worktree, start
  the main checkout's containers: Compose uses fixed container names.
- `npm run lint`, `npm run typecheck` (only `src/`), `npm run prettier:check`.
- `npm install` can change `package-lock.json`: restore it before you review,
  so that no reviewer reports it.
