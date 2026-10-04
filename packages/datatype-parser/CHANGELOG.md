# Changelog — `@clickhouse/datatype-parser`

> This file tracks the standalone `@clickhouse/datatype-parser` package. Entries
> relevant to it (through `@clickhouse/client` 1.23.0) were previously recorded
> in the now-frozen repository-wide [`CHANGELOG.md`](../../CHANGELOG.md).

# 0.1.3

## Migration Notes

- Node.js 18.x is no longer supported. The `engines.node` floor was raised from `>=18.0.0` to `>=20`. Node.js 20.x, 22.x, 24.x, and 26.x are supported and exercised in CI. ([#906])

# 0.1.2

## New features

- Initial published release of `@clickhouse/datatype-parser`: a small, dependency-free standalone parser for ClickHouse data-type strings (the kind sent in the types row of `RowBinaryWithNamesAndTypes`, e.g. `Array(Nullable(UInt64))`, `Tuple(a UInt8, b String)`, `Enum8('a' = 1)`). It is a faithful port of the server's `ParserDataType` and emits a JSON AST that is byte-identical to the server's `EXPLAIN AST json = 1` data-type subtree (`parseDataType` plus its `Node` AST). It supersedes the deprecated `parseColumnType` exported from `@clickhouse/client`, `@clickhouse/client-web`, and `@clickhouse/client-common`. ([#893])

[#893]: https://github.com/ClickHouse/clickhouse-js/pull/893
[#906]: https://github.com/ClickHouse/clickhouse-js/pull/906
