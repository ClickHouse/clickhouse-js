# Changelog — `@clickhouse/rowbinary`

> This file tracks the standalone `@clickhouse/rowbinary` package (the RowBinary
> parser library and agent skill). Entries relevant to it (through
> `@clickhouse/client` 1.23.0) were previously recorded in the now-frozen
> repository-wide [`CHANGELOG.md`](../../CHANGELOG.md).

# 0.1.2

## Improvements

- Bumped the bundled `@clickhouse/datatype-parser` dependency to `0.1.2`. ([#895])
- Patch release. ([#903])

# 0.1.1

## New features

- Initial release of `@clickhouse/rowbinary`: a RowBinary reader library (and the companion agent skill) shipping type-specific, monomorphizable building blocks for decoding `RowBinary` / `RowBinaryWithNames` / `RowBinaryWithNamesAndTypes` streams (full-buffer and chunked), plus a skill that guides an agent to generate bespoke high-performance parsers from a query's column types. The same library is also bundled into `@clickhouse/client` (registered in `agents.skills`). Requires Node.js `>=20`. A matching RowBinary writer is planned. ([#864])

[#864]: https://github.com/ClickHouse/clickhouse-js/pull/864
[#895]: https://github.com/ClickHouse/clickhouse-js/pull/895
[#903]: https://github.com/ClickHouse/clickhouse-js/pull/903
