## 0.0.10, 2022-11-14
### New features
- Remove request listeners synchronously.
[#123](https://github.com/ClickHouse/clickhouse-js/issues/123)

## 0.0.9, 2022-10-25
### New features
- Added ClickHouse session_id support.
[#121](https://github.com/ClickHouse/clickhouse-js/pull/121)

## 0.0.8, 2022-10-18
### New features
- Added SSL/TLS support (basic and mutual).
[#52](https://github.com/ClickHouse/clickhouse-js/issues/52)

## 0.0.7, 2022-10-18
### Bug fixes
- Allow semicolons in select clause.
[#116](https://github.com/ClickHouse/clickhouse-js/issues/116)

## 0.0.6, 2022-10-07
### New features
- Add JSONObjectEachRow input/output and JSON input formats.
[#113](https://github.com/ClickHouse/clickhouse-js/pull/113)

## 0.0.5, 2022-10-04
### Breaking changes
  - Rows abstraction was renamed to ResultSet.
  - now, every iteration over `ResultSet.stream()` yields `Row[]` instead of a single `Row`.
Please check out [an example](https://github.com/ClickHouse/clickhouse-js/blob/c86c31dada8f4845cd4e6843645177c99bc53a9d/examples/select_streaming_on_data.ts)
and [this PR](https://github.com/ClickHouse/clickhouse-js/pull/109) for more details.
These changes allowed us to significantly reduce overhead on select result set streaming.
### New features
- [split2](https://www.npmjs.com/package/split2) is no longer a package dependency.
