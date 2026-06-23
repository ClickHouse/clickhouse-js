# chdt — standalone ClickHouse data-type parser

A small, self-contained C++ library that parses a ClickHouse **data-type
string** (the kind sent in the types row of `RowBinaryWithNamesAndTypes`, e.g.
`Array(Nullable(UInt64))`, `Tuple(a UInt8, b String)`, `Enum8('a' = 1)`,
`Decimal(10, 2)`) into a JSON AST.

It is extracted from the server's `ParserDataType`
(`src/Parsers/ParserDataType.cpp`) but has **no dependency on the ClickHouse
source tree** — only the C++20 standard library. The JSON it emits mirrors the
data-type subtree of the frozen `EXPLAIN AST json = 1` document (format
**version 2**; see `AST.md` in the ClickHouse repo), so its output is a drop-in
match for what the server produces.

## Why this exists

The server's type parser is entangled with the lexer, the expression parsers,
and the `IAST` / `Field` machinery. Vendoring all of that verbatim would pull
in ~9–10k lines (`Field`, `ReadHelpers`, `Exception`, the formatting/hashing
layer). Instead, this reimplements just the type grammar on a minimal AST:

- a purpose-built tokenizer (`src/lexer.*`) covering the slice of SQL that type
  strings use, in place of the full `Lexer` and its `UTF8Helpers` /
  `find_symbols` dependencies;
- a faithful port of `ParserDataType::parseImpl` (`src/parser.cpp`) — same
  control flow: identifier + SQL-standard multi-word aliases, the Enum and
  Tuple special cases, then the generic parametric-argument loop;
- plain structs for the AST (`include/chdt/ast.h`) instead of `IAST` + `Field`.

## Build and test

```bash
rm -rf build # clean the build dir for a fresh run
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build
```

## Usage

Library:

```cpp
#include "chdt/parser.h"

chdt::ParseResult r = chdt::parseDataType("Tuple(a UInt8, b String)");
if (r.ok())
    std::string json = chdt::toJSON(*r.ast);
else
    /* r.error->message, r.error->position */;
```

CLI:

```bash
./build/chdt-parse "Array(Nullable(UInt64))"
echo "Enum8('a' = 1, 'b' = 2)" | ./build/chdt-parse
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

`EnumDataType.values` and `TupleDataType.element_names` are carried here exactly
as the server emits them since format v2.

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

`ctest` runs two suites against the parser:

- **oracle** (`test/oracle_compare.py`) — for each type in `test/cases.txt`,
  compares the parser's JSON against the `data_type` subtree the real server
  emits for `CREATE TABLE t (c <TYPE>) ENGINE = Null`. Needs a `clickhouse`
  binary (default: `../build/programs/clickhouse`; override with
  `-DCLICKHOUSE_BINARY=...`).
- **unsupported** (`test/check_unsupported.py`) — asserts the deferred types in
  `test/cases_unsupported.txt` are rejected.

```bash
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DCLICKHOUSE_BINARY=/work/ClickHouse/build/programs/clickhouse
cmake --build build
ctest --test-dir build --output-on-failure
```

When the AST format changes get merged the special build `/work/ClickHouse/build/programs/clickhouse` wouldn't be needed.
