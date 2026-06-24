# chdt-ts — standalone ClickHouse data-type parser (TypeScript)

A small, self-contained TypeScript library that parses a ClickHouse **data-type
string** (the kind sent in the types row of `RowBinaryWithNamesAndTypes`, e.g.
`Array(Nullable(UInt64))`, `Tuple(a UInt8, b String)`, `Enum8('a' = 1)`,
`Decimal(10, 2)`) into a JSON AST.

It is a faithful port of the C++ `chdt` library (see `../mini-parser-extracted`),
which is itself extracted from the server's `ParserDataType`
(`src/Parsers/ParserDataType.cpp`). It has **no runtime dependencies** — only the
Node.js standard library. The JSON it emits mirrors the data-type subtree of the
frozen `EXPLAIN AST json = 1` document (format **version 2**), so its output is a
drop-in match for what the server produces — and is **byte-identical** to the C++
parser's output across the full test corpus.

## Layout

The module structure tracks the C++ sources one-to-one:

| TypeScript          | ported from (C++)                | role                                    |
| ------------------- | -------------------------------- | --------------------------------------- |
| `src/ast.ts`        | `include/chdt/ast.h`             | the AST node shape + `makeNode` factory |
| `src/lexer.ts`      | `src/lexer.{h,cpp}`              | the purpose-built tokenizer             |
| `src/parser.ts`     | `src/parser.cpp` + `parser.h`    | the `ParserDataType::parseImpl` port    |
| `src/json.ts`       | `src/json.cpp`                   | the byte-faithful JSON serializer       |
| `src/index.ts`      | —                                | public barrel                           |
| `tool/main.ts`      | `tool/main.cpp`                  | the `chdt-parse` CLI                     |

The lexer and parser deliberately preserve the original control flow, branch
ordering, helper names, and `pos` save/restore points. A few signatures changed
where C++ used out-parameters (`std::string &`): `parseIdentifier` and
`decodeQuoted` return small result objects instead.

## Install & build

```bash
npm install
npm run build      # emits dist/ (JS + .d.ts)
npm run typecheck  # tsc --noEmit
```

## Usage

Library:

```ts
import { parseDataType, toJSON } from "@clickhouse/datatype-parser";

const r = parseDataType("Tuple(a UInt8, b String)");
if (r.ok()) {
  console.log(toJSON(r.ast!));      // pretty (2-space) JSON
  console.log(toJSON(r.ast!, -1));  // compact JSON
} else {
  console.error(r.error!.message, r.error!.position);
}
```

CLI (no build step needed — runs via `tsx`):

```bash
npm run parse -- "Array(Nullable(UInt64))"
echo "Enum8('a' = 1, 'b' = 2)" | npm run parse

# or, after `npm run build`:
node dist/tool/main.js "Tuple(a UInt8, b String)"
```

## Output shape

Node types and slots match the server (format v2):

| `type`          | slots                                                    |
| --------------- | -------------------------------------------------------- |
| `DataType`      | `name`, `arguments?` (present iff the type had `(...)`)  |
| `EnumDataType`  | `name`, `values` (array of `{ name, value }`)            |
| `TupleDataType` | `name`, `arguments?`, `element_names?` (named tuples)    |
| `NameTypePair`  | `name`, `data_type` (a `Nested(...)` element)            |
| `Literal`       | `value_type`, `value` (64-bit ints as JSON strings)      |
| `Function`      | `name`, `is_operator?`, `arguments` (e.g. `max_types=5`) |
| `Identifier`    | `name`, `name_parts?`                                    |

## Coverage

Supported: scalars, parametric types with literal args (`Decimal`,
`FixedString`, `DateTime64`, …), nested type args (`Array`, `Map`, `Nullable`,
`LowCardinality`, `Variant`, …), enums (explicit → `EnumDataType`;
auto-assigned → generic `DataType`), named/unnamed/mixed tuples, `Nested`,
`Dynamic(max_types = N)`, the legacy `Object('json')`, and the SQL-standard
multi-word aliases (`DOUBLE PRECISION`, `CHAR VARYING`, `INT SIGNED`, …).

**Deliberately not supported yet** (the parser returns a clear error):

- `AggregateFunction` / `SimpleAggregateFunction` — needs the function-expression
  parser the server reaches for here.
- the new `JSON(...)` object-argument syntax (`JSON(a.b UInt32, SKIP x)`). Bare
  `JSON` and legacy `Object('json')` parse fine.

## Tests

```bash
npm test                  # node:test: unit suite + snapshot corpus — NO clickhouse needed
npm run test:unsupported  # asserts the deferred types are rejected
```

`npm test` requires **no `clickhouse` binary** — it runs entirely against
checked-in fixtures:

- **unit** (`test/parser.test.ts`) — pins representative AST shapes and all the
  deliberate rejections.
- **snapshot** (`test/snapshot.test.ts`) — for every type in `test/cases.txt`
  (356 and counting), compares the parser's JSON against a checked-in static
  snapshot of the real server's `data_type` subtree, in `test/snapshots/`
  (one `<sha1>.json` per query). Because a snapshot is only written when the
  server accepted the type **and** the parser matched it, "parser == snapshot"
  means "parser == server".

### Regenerating / extending the snapshot corpus

The snapshots are captured from a real server by `update_snapshots.ts`, which
needs a `clickhouse` binary built from
https://github.com/peter-leonov-ch/ClickHouse/pull/1 (the AST-format changes
this parser mirrors live in that PR; a stock build will not match):

```bash
npm run snapshot:update -- --clickhouse /path/to/clickhouse
```

It validates every type in `test/cases.txt` plus any in `test/candidates.txt`
(a seed list of additional types), keeps only those the server accepts and the
parser matches, appends new keepers to `cases.txt`, writes a snapshot per kept
query, and prunes orphans. Types the server rejects or where the parser diverges
are dropped and listed in `test/snapshots_report.txt` (never silently added).

There is also a live comparison that skips the snapshots and queries the server
directly, useful while iterating:

```bash
npm run test:oracle -- --clickhouse /path/to/clickhouse
```

### Confirming the corpus is real (no invented types)

The oracle compares against the server's **parser** (`ParserDataType`), which is
what this library mirrors. To additionally confirm that every type in the corpus
is a *real* ClickHouse type — not just syntactically well-formed — there is a
check that **instantiates** each type against any stock running server (no
AST-JSON support needed; over the HTTP interface):

```bash
npm run validate:live -- --url http://localhost:8124/
```

It runs `CREATE TEMPORARY TABLE _probe (c <TYPE>)` (session-scoped, nothing
persisted) with the relevant experimental settings enabled, so an unknown type
family fails with `UNKNOWN_TYPE`. As of the latest run, **347/356 instantiate
and 0 are unexpected**.

The remaining 9 are listed in `test/non_instantiable.txt`: types the parser
accepts (and whose AST matches the server's parser) but that the server's **type
factory** later rejects — e.g. partial tuple naming (`Tuple(a UInt8, String)`),
`Nullable` inside `Variant`, `Nullable(Tuple(...))`, `Dynamic(max_types = 255)`,
the `BINARY` alias without a size, and the legacy `Object('json')` (removed in
recent servers). These are deliberate parser test inputs — this is a type-string
*parser*, not a type validator — so they are allowlisted, and `validate:live`
exits non-zero only on an *unexpected* failure.

